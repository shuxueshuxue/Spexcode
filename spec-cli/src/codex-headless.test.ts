import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexHeadlessLaunchCommand } from './codex-headless.js'
import { codexAppServerSock, codexHarness, codexHeadlessHarness, HARNESSES } from './harness.js'
import { processStartToken } from './process-identity.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('codex-headless composes Codex materialization and shared-runtime ownership without a TUI attach', () => {
  assert.deepEqual(HARNESSES.map((h) => h.id), [
    'claude', 'codex', 'opencode', 'pi',
    'claude-headless', 'opencode-headless', 'pi-headless', 'codex-headless',
  ])
  const proj = process.cwd()
  assert.equal(codexHeadlessHarness.shimFile(proj), codexHarness.shimFile(proj))
  assert.deepEqual(codexHeadlessHarness.contractFiles(proj), codexHarness.contractFiles(proj))
  assert.equal(codexHeadlessHarness.skillDir(proj), codexHarness.skillDir(proj))
  assert.equal(codexHeadlessHarness.agentDir(proj), codexHarness.agentDir(proj))
  assert.equal(codexHeadlessHarness.shim('/dispatch', '/spex').content, codexHarness.shim('/dispatch', '/spex').content)
  assert.equal(codexHeadlessHarness.sessionIdArg('abc'), '')
  assert.equal(codexHeadlessHarness.resumeArg({ session: 'abc', harnessSessionId: 'thread-1' }), '')
  assert.equal(codexHeadlessHarness.headless, true)
  assert.equal(codexHeadlessHarness.ownsRendezvous, false)
  assert.equal(codexHeadlessHarness.liveness({ session: 'abc' }, false), 'online')
  assert.equal(codexHeadlessHarness.liveness({ session: 'abc', stopped: true }, false), 'offline')
  assert.equal(typeof codexHeadlessHarness.launchReady, 'function')
  assert.equal(codexHeadlessHarness.deliver, codexHarness.deliver)
  assert.equal(codexHeadlessHarness.sharedRuntimes, codexHarness.sharedRuntimes)
  const headlessRuntime = codexHeadlessHarness.sharedRuntimes?.('/tmp/runtime') ?? []
  const interactiveRuntime = codexHarness.sharedRuntimes?.('/tmp/runtime') ?? []
  const descriptorContract = (descriptor: (typeof headlessRuntime)[number]) => ({
    key: descriptor.key,
    label: descriptor.label,
    pidFile: descriptor.pidFile,
    isolationFile: descriptor.isolationFile,
    capabilities: {
      probe: typeof descriptor.probe,
      residency: typeof descriptor.residency,
      mutationGuard: typeof descriptor.mutationGuard,
    },
  })
  assert.deepEqual(headlessRuntime.map(descriptorContract), interactiveRuntime.map(descriptorContract))
  assert.deepEqual(headlessRuntime.map(descriptorContract), [{
    key: 'codex-app-server',
    label: 'Codex app-server',
    pidFile: '/tmp/runtime/codex-app-server.pid',
    isolationFile: '/tmp/runtime/codex-app-server.scope',
    capabilities: { probe: 'function', residency: 'function', mutationGuard: 'function' },
  }])
})

test('codex-headless launch starts the shared app-server and first turn, then exits without attaching a TUI', () => {
  const cmd = codexHeadlessLaunchCommand('session-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  assert.match(cmd, /internal shared-runtime-spawn [^\n]* codex app-server --listen "unix:\/\/\$sock"/)
  assert.match(cmd, /internal codex-launch "\$sock" "\$PWD" "\$@"/)
  assert.match(cmd, /internal session-turn-fail.*codex-headless/, 'non-zero one-shot turns report through the shared outcome seam')
  assert.match(cmd, /elif \[ "\$#" -eq 0 \]; then/)
  assert.doesNotMatch(cmd, /exec codex --yolo --remote unix:\/\/"\$sock" resume "\$tid"/)
})

test('codex-headless launch readiness requires one exact loaded governed target on a live detached root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-codex-headless-ready-'))
  const runtime = join(root, 'runtime'); const sockets = join(root, 'sockets')
  mkdirSync(runtime); mkdirSync(sockets)
  const previousSockets = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const originalShared = codexHeadlessHarness.sharedRuntimes
  const originalNow = Date.now
  process.env.SPEXCODE_CODEX_SOCKET_DIR = sockets
  const socket = codexAppServerSock(runtime)
  const identity = spawnDetachedRuntime({
    cwd: runtime,
    logFile: join(runtime, 'codex-app-server.log'),
    pidFile: join(runtime, 'codex-app-server.pid'),
    isolationFile: join(runtime, 'codex-app-server.scope'),
    command: process.execPath,
    args: ['-e', `const net=require('net');const fs=require('fs');try{fs.unlinkSync(${JSON.stringify(socket)})}catch{};net.createServer(()=>{}).listen(${JSON.stringify(socket)});setInterval(()=>{},1000)`],
  })
  try {
    for (let i = 0; i < 100 && !existsSync(socket); i++) await sleep(20)
    assert.equal(processStartToken(identity.pid), identity.startToken)
    assert.equal(existsSync(socket), true)
    codexHeadlessHarness.sharedRuntimes = () => [{
      key: 'codex-app-server', label: 'Codex app-server',
      pidFile: join(runtime, 'codex-app-server.pid'), isolationFile: join(runtime, 'codex-app-server.scope'),
      residency: async () => ({ healthy: true, referenceIds: ['thread-ready'] }),
      probe: async () => ({ healthy: true, references: [{ referenceId: 'thread-ready', turnPresence: 'idle' }] }),
    }]
    const current = () => ({ session: 'session-ready', governed: true, harnessSessionId: 'thread-ready', stopped: false, archived: false, runtimeDir: runtime })
    assert.equal(await codexHeadlessHarness.launchReady!(current), true)

    codexHeadlessHarness.sharedRuntimes = () => [{
      key: 'codex-app-server', label: 'Codex app-server',
      pidFile: join(runtime, 'codex-app-server.pid'), isolationFile: join(runtime, 'codex-app-server.scope'),
      residency: async () => ({ healthy: true, referenceIds: ['thread-ready', 'thread-ready'] }),
      probe: async () => ({ healthy: true, references: [] }),
    }]
    const now = originalNow()
    let calls = 0
    Date.now = () => calls++ === 0 ? now : now + 30_001
    assert.equal(await codexHeadlessHarness.launchReady!(current), false, 'duplicate target references are not a readiness proof')
  } finally {
    Date.now = originalNow
    codexHeadlessHarness.sharedRuntimes = originalShared
    if (processStartToken(identity.pid) === identity.startToken) {
      try { process.kill(identity.pid, 'SIGTERM') } catch { /* already exited */ }
      for (let i = 0; i < 100 && processStartToken(identity.pid) === identity.startToken; i++) await sleep(20)
    }
    if (previousSockets === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSockets
    rmSync(root, { recursive: true, force: true })
  }
})
