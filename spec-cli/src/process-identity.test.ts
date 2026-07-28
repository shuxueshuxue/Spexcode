import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  processStartToken,
  verifyDetachedRuntime,
  writeDetachedRuntimeReceipt,
  type ProcessAdapter,
} from './process-identity.js'

type FakeState = { start: string | null; processGroupId: number | null; linuxSessionId: number | null }

const fakeAdapter = (hostPlatform: NodeJS.Platform, state: FakeState, onLinuxSessionRead?: () => void): ProcessAdapter => ({
  platform: hostPlatform,
  startToken: () => state.start,
  processGroupId: () => state.processGroupId,
  linuxSessionId: () => { onLinuxSessionRead?.(); return state.linuxSessionId },
})

const rewriteReceipt = (file: string, change: (receipt: Record<string, unknown>) => void) => {
  const receipt = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  change(receipt)
  writeFileSync(file, `${JSON.stringify(receipt)}\n`)
}

test('Darwin accepts detached PID/start/PGID when ps sess=0 and never consumes that session value', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-darwin-detached-'))
  const receipt = join(root, 'runtime.detached.json')
  const state: FakeState = { start: 'Tue Jul 28 08:00:00 2026', processGroupId: 18378, linuxSessionId: 0 }
  let sessionReads = 0
  const adapter = fakeAdapter('darwin', state, () => sessionReads++)
  try {
    const written = writeDetachedRuntimeReceipt(18378, receipt, adapter)
    assert.deepEqual(written, {
      pid: 18378,
      startToken: state.start,
      receiptVersion: 4,
      processGroupId: 18378,
    })
    assert.equal(verifyDetachedRuntime(18378, receipt, adapter).ok, true)
    assert.equal(sessionReads, 0, 'Darwin does not ask the adapter for ps sess or synthesize a session id')
    assert.equal(Object.hasOwn(JSON.parse(readFileSync(receipt, 'utf8')), 'linuxSessionId'), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('detached verifier rejects missing, malformed, wrong receipt identity and changed live identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-detached-negatives-'))
  const receipt = join(root, 'runtime.detached.json')
  const state: FakeState = { start: 'start-a', processGroupId: 71, linuxSessionId: 71 }
  const adapter = fakeAdapter('linux', state)
  const restore = () => {
    state.start = 'start-a'; state.processGroupId = 71; state.linuxSessionId = 71
    writeDetachedRuntimeReceipt(71, receipt, adapter)
  }
  try {
    const missing = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.match(missing.reason, /missing/)

    writeFileSync(receipt, 'detached-v3 71 start-a 71 71\n')
    const legacy = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(legacy.ok, false)
    if (!legacy.ok) assert.match(legacy.reason, /wrong version or shape/)

    restore(); rewriteReceipt(receipt, (value) => { value.pid = 72 })
    const wrongPid = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(wrongPid.ok, false)
    if (!wrongPid.ok) assert.match(wrongPid.reason, /names PID 72/)

    restore(); rewriteReceipt(receipt, (value) => { value.startToken = 'wrong' })
    const wrongStartReceipt = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(wrongStartReceipt.ok, false)
    if (!wrongStartReceipt.ok) assert.match(wrongStartReceipt.reason, /start identity does not match/)

    restore(); rewriteReceipt(receipt, (value) => { value.processGroupId = 70 })
    const wrongGroupReceipt = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(wrongGroupReceipt.ok, false)
    if (!wrongGroupReceipt.ok) assert.match(wrongGroupReceipt.reason, /wrong process group 70/)

    restore(); state.start = 'start-b'
    const changedStart = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(changedStart.ok, false)
    if (!changedStart.ok) assert.match(changedStart.reason, /start identity does not match/)

    restore(); state.processGroupId = 70
    const changedGroup = verifyDetachedRuntime(71, receipt, adapter)
    assert.equal(changedGroup.ok, false)
    if (!changedGroup.ok) assert.match(changedGroup.reason, /not its own process-group leader/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Linux requires both receipt and live /proc SID to equal PID', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-linux-detached-'))
  const receipt = join(root, 'runtime.detached.json')
  const state: FakeState = { start: '4242', processGroupId: 83, linuxSessionId: 83 }
  const adapter = fakeAdapter('linux', state)
  try {
    writeDetachedRuntimeReceipt(83, receipt, adapter)
    const accepted = verifyDetachedRuntime(83, receipt, adapter)
    assert.equal(accepted.ok, true)
    if (accepted.ok) assert.equal(accepted.identity.linuxSessionId, 83)

    state.linuxSessionId = 1
    const wrongLiveSid = verifyDetachedRuntime(83, receipt, adapter)
    assert.equal(wrongLiveSid.ok, false)
    if (!wrongLiveSid.ok) assert.match(wrongLiveSid.reason, /not its own session leader/)

    state.linuxSessionId = 83
    rewriteReceipt(receipt, (value) => { value.linuxSessionId = 1 })
    const wrongReceiptSid = verifyDetachedRuntime(83, receipt, adapter)
    assert.equal(wrongReceiptSid.ok, false)
    if (!wrongReceiptSid.ok) assert.match(wrongReceiptSid.reason, /wrong Linux session 1/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('real detached runtime survives its launcher receiving SIGHUP', { timeout: 10_000, skip: platform() === 'win32' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-detached-hup-'))
  const pidFile = join(root, 'runtime.pid')
  const receipt = join(root, 'runtime.detached.json')
  const moduleUrl = new URL('./runtime-ownership.ts', import.meta.url).href
  const script = [
    `import { spawnDetachedRuntime } from ${JSON.stringify(moduleUrl)}`,
    `spawnDetachedRuntime(${JSON.stringify({
      cwd: root,
      logFile: join(root, 'runtime.log'),
      pidFile,
      receiptFile: receipt,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })})`,
    'setInterval(() => {}, 1000)',
  ].join(';')
  const launcher = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    stdio: 'ignore',
  })
  let runtimePid = 0
  let startToken: string | null = null
  try {
    for (let i = 0; i < 200 && !existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(existsSync(pidFile), true, 'launcher published the detached runtime identity')
    runtimePid = Number(readFileSync(pidFile, 'utf8').trim())
    startToken = processStartToken(runtimePid)
    assert.ok(startToken)
    launcher.kill('SIGHUP')
    const [, signal] = await once(launcher, 'exit') as [number | null, NodeJS.Signals | null]
    assert.equal(signal, 'SIGHUP')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(processStartToken(runtimePid), startToken)
    const verified = verifyDetachedRuntime(runtimePid, receipt)
    assert.equal(verified.ok, true)
  } finally {
    if (launcher.exitCode === null && launcher.signalCode === null) launcher.kill('SIGKILL')
    if (runtimePid > 0 && startToken && processStartToken(runtimePid) === startToken) {
      try { process.kill(runtimePid, 'SIGTERM') } catch {}
      for (let i = 0; i < 100 && processStartToken(runtimePid) === startToken; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    }
    rmSync(root, { recursive: true, force: true })
  }
})
