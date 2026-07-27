import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexAppServerIsolation, codexAppServerPid, codexHarness, codexHeadlessHarness, sessionIdentityEnvVars, type SharedRuntimeProbe } from './harness.js'
import { repoRoot } from './git.js'
import { runtimeRoot } from './layout.js'
import {
  assertSessionStopSafe,
  collectResourceReport,
} from './host-resources.js'
import { parseProcStat, processStartToken, processTopology } from './process-identity.js'
import { registerBackendInstance, spawnDetachedRuntime, unregisterBackendInstance, writeIsolationStamp } from './runtime-ownership.js'

test('parseProcStat keeps PID identity separate from process name punctuation', () => {
  const fields = ['S', '7', '8', '9', '0', '0', '0', '0', '0', '0', '0', '11', '13', '0', '0', '0', '0', '0', '0', '4242', '0', '21']
  assert.deepEqual(parseProcStat(`123 (name with ) paren) ${fields.join(' ')}`), {
    ppid: 7,
    processGroupId: 8,
    sessionId: 9,
    ticks: 24,
    startToken: '4242',
    rssPages: 21,
  })
})

test('shared runtime spawn records an observed detached process boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-detached-runtime-'))
  const pidFile = join(root, 'runtime.pid')
  const isolationFile = join(root, 'runtime.scope')
  let identity: { pid: number; startToken: string } | null = null
  try {
    identity = spawnDetachedRuntime({
      cwd: root,
      logFile: join(root, 'runtime.log'),
      pidFile,
      isolationFile,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    const topology = processTopology(identity.pid)
    assert.deepEqual(topology, { ...identity, processGroupId: identity.pid, sessionId: identity.pid })
    assert.equal(readFileSync(pidFile, 'utf8'), `${identity.pid}\n`)
    assert.equal(readFileSync(isolationFile, 'utf8'), `detached-v3 ${identity.pid} ${identity.startToken} ${identity.pid} ${identity.pid}\n`)
  } finally {
    if (identity && processStartToken(identity.pid) === identity.startToken) {
      try { process.kill(identity.pid, 'SIGTERM') } catch {}
      for (let i = 0; i < 50 && processStartToken(identity.pid) === identity.startToken; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test('shared-runtime projection uses live adapter refs and fail-closed process identity', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-resources-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const target = 'resource-target'
  const sibling = 'resource-sibling'
  const queued = 'resource-queued'
  const duplicate = 'resource-duplicate'
  const foreign = 'resource-foreign'
  const nonGoverned = 'resource-non-governed'
  const orphan = 'retired-owner'
  let child: ReturnType<typeof spawn> | null = null
  let sharedRoot: ReturnType<typeof spawn> | null = null
  let sessionLeaf: ReturnType<typeof spawn> | null = null
    let staleBackend: ReturnType<typeof spawn> | null = null
    const originalSharedRuntimes = codexHarness.sharedRuntimes
    const originalHeadlessSharedRuntimes = codexHeadlessHarness.sharedRuntimes
  let probe: SharedRuntimeProbe = { healthy: true, references: [] }

  try {
    const root = runtimeRoot()
    const worktrees = new Map([[target, join(home, 'target-wt')], [sibling, join(home, 'sibling-wt')], [queued, join(home, 'queued-wt')], [duplicate, join(home, 'duplicate-wt')], [foreign, join(home, 'foreign-wt')], [nonGoverned, join(home, 'non-governed-wt')]])
    const governedProbe = (includeUnowned: boolean): SharedRuntimeProbe => ({
      healthy: true,
      references: [
        { referenceId: 'thread-target', turnPresence: 'active' },
        { referenceId: 'thread-sibling', turnPresence: 'unknown' },
        ...(includeUnowned ? [{ referenceId: 'thread-without-record', turnPresence: 'idle' as const }] : []),
      ],
    })
    probe = governedProbe(false)
    for (const [id, path] of worktrees) {
      mkdirSync(path, { recursive: true })
      execFileSync('git', ['-C', path, 'init', '-q', '-b', `node/${id}`])
      execFileSync('git', ['-C', path, 'config', 'user.email', 'resource@example.test'])
      execFileSync('git', ['-C', path, 'config', 'user.name', 'Resource Test'])
    }
    const record = (id: string, thread: string | null, terminal = false, overrides: Record<string, unknown> = {}) => ({
      session_id: id,
      governed: true,
      worktree_path: worktrees.get(id)!,
      branch: `node/${id}`,
      node: null,
      title: null,
      name: null,
      parent: null,
      status: terminal ? 'awaiting' : thread ? 'active' : 'queued',
      proposal: terminal ? 'nothing' : null,
      merges: 0,
      note: null,
      sortkey: null,
      createdAt: Date.now(),
      harness: 'codex',
      harness_session_id: thread,
      stopped: false,
      archived: false,
      launcher: 'codex',
      launch_cmd: 'codex --yolo',
      ...overrides,
    })
    for (const [id, thread, terminal] of [[target, 'thread-target', true], [sibling, 'thread-sibling', false], [queued, null, false]] as const) {
      const dir = join(root, 'sessions', id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.json'), `${JSON.stringify(record(id, thread, terminal), null, 2)}\n`)
    }
    const fixtureSharedRuntimes = (runtimeDir: string) => originalSharedRuntimes!(runtimeDir).map((descriptor) => ({ ...descriptor, probe: async () => probe }))
    codexHarness.sharedRuntimes = fixtureSharedRuntimes
    codexHeadlessHarness.sharedRuntimes = fixtureSharedRuntimes

    sharedRoot = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: true,
      env: { ...process.env, SPEXCODE_PROJECT_ROOT: repoRoot(), SPEXCODE_SESSION_ID: target },
    })
    sessionLeaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      env: { ...process.env, SPEXCODE_PROJECT_ROOT: repoRoot(), SPEXCODE_SESSION_ID: target, CODEX_THREAD_ID: 'thread-target' },
    })
    for (let i = 0; i < 50 && (!processStartToken(sharedRoot.pid!) || !processStartToken(sessionLeaf.pid!)); i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(processStartToken(sharedRoot.pid!) && processStartToken(sessionLeaf.pid!), 'shared and leaf fixtures acquired process-start tokens')
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /live sibling thread.*no readable owner PID/)
    writeFileSync(codexAppServerPid(root), '99999999\n')
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /no readable process-start identity/)
    writeFileSync(codexAppServerPid(root), `${sharedRoot.pid}\n`)
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /no matching live detached process-boundary proof/)
    writeIsolationStamp(sharedRoot.pid!, codexAppServerIsolation(root))
    await assert.doesNotReject(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }))
    probe = { healthy: true, references: [] }
    await assert.rejects(() => assertSessionStopSafe(target, null), /no readable session record proves the adapter or leaf owner/)
    probe = governedProbe(true)
    await assert.doesNotReject(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }))
    const foreignDir = join(root, 'sessions', foreign)
    mkdirSync(foreignDir, { recursive: true })
    writeFileSync(join(foreignDir, 'session.json'), `${JSON.stringify(record(foreign, 'thread-without-record', false, { harness: 'claude' }), null, 2)}\n`)
    await assert.doesNotReject(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }))
    rmSync(foreignDir, { recursive: true, force: true })
    const nonGovernedDir = join(root, 'sessions', nonGoverned)
    mkdirSync(nonGovernedDir, { recursive: true })
    writeFileSync(join(nonGovernedDir, 'session.json'), `${JSON.stringify(record(nonGoverned, 'thread-without-record', false, { governed: false }), null, 2)}\n`)
    await assert.doesNotReject(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }))
    const collisionReport = await collectResourceReport({ persist: false })
    const collisionShared = collisionReport.owners.find((owner) => owner.kind === 'shared-runtime' && owner.id === 'codex-app-server')
    assert.equal(collisionShared?.references?.find((reference) => reference.threadId === 'thread-without-record')?.ownerState, 'unowned')
    rmSync(nonGovernedDir, { recursive: true, force: true })
    probe = governedProbe(false)
    const duplicateDir = join(root, 'sessions', duplicate)
    mkdirSync(duplicateDir, { recursive: true })
    writeFileSync(join(duplicateDir, 'session.json'), `${JSON.stringify(record(duplicate, 'thread-target'), null, 2)}\n`)
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /target thread thread-target has no one exact governed session owner/)
    probe = { healthy: true, references: [] }
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /target thread thread-target has no one exact governed session owner/,
      'duplicate record ownership stays ambiguous even while the native thread is unloaded')
    probe = governedProbe(false)
    rmSync(duplicateDir, { recursive: true, force: true })
    rmSync(codexAppServerPid(root), { force: true })
    probe = { healthy: false, references: [], error: 'fixture probe failed' }
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /unproven live reference set.*no readable owner PID/)
    const unknownReport = await collectResourceReport({ persist: false })
    const unknownShared = unknownReport.owners.find((owner) => owner.kind === 'shared-runtime' && owner.id === 'codex-app-server')
    assert.equal(unknownShared?.controlPlane?.refCount, null, 'an unhealthy probe reports an unknown refcount')
    assert.ok(unknownShared?.references?.every((reference) => !reference.protectsControlPlane), 'records stay visible but cannot invent live references')
    assert.ok(unknownShared?.references?.some((reference) => reference.referenceState === 'queued-no-thread'))
    writeFileSync(codexAppServerPid(root), '99999999\n')
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /unproven live reference set.*no readable process-start identity/)
    writeFileSync(codexAppServerPid(root), `${sharedRoot.pid}\n`)
    probe = governedProbe(true)

    child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      env: { ...process.env, SPEXCODE_PROJECT_ROOT: repoRoot(), SPEXCODE_SESSION_ID: orphan },
    })
    for (let i = 0; i < 50 && !processStartToken(child.pid!); i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(processStartToken(child.pid!), 'fixture child acquired a process-start token')

    const beforeProof = await collectResourceReport({ persist: false })
    const unproven = beforeProof.owners.find((owner) => owner.kind === 'shared-runtime' && owner.id === 'codex-app-server')
    assert.equal(unproven?.controlPlane?.refCount, 3)
    assert.equal(unproven?.references?.filter((ref) => ref.protectsControlPlane).length, 3)
    assert.equal(unproven?.references?.filter((ref) => ref.referenceState === 'queued-no-thread').length, 1)
    assert.ok(unproven?.references?.some((ref) => ref.ownerState === 'unowned'))
    assert.ok(unproven?.findings.includes('unowned-loaded-thread'))
    assert.ok(unproven?.findings.includes('turn-presence-unknown'))
    const report = beforeProof
    const shared = unproven
    assert.ok(shared?.processes.some((proc) => proc.pid === sharedRoot!.pid), 'legacy fallback session env does not steal shared-root ownership')
    assert.ok(shared?.findings.includes('identity-leak:project-control-plane-carries-session-id'))
    const governed = report.owners.find((entry) => entry.kind === 'session' && entry.id === target)
    assert.ok(governed?.processes.some((proc) => proc.pid === sessionLeaf!.pid), 'acting adapter thread remains charged to its session')
    assert.equal(governed?.worktreePath, worktrees.get(target))
    assert.equal(governed?.branch, `node/${target}`)
    assert.equal(governed?.proposal, 'nothing')
    assert.equal(governed?.reclaim?.eligible, true, 'an exact terminal target stays reclaimable while unrelated unowned refs protect the shared root')
    writeFileSync(join(root, 'sessions', target, 'session.json'), `${JSON.stringify(record(target, 'thread-target'), null, 2)}\n`)

    const owner = report.owners.find((entry) => entry.kind === 'orphan' && entry.id === orphan)
    assert.equal(owner?.reclaim?.eligible, true, 'proven absent owner is projected as eligible without creating a mutation token')

    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
    child = null

    for (const proc of [sessionLeaf, sharedRoot]) {
      const exited = once(proc!, 'exit')
      proc!.kill('SIGTERM')
      await exited
    }
    sessionLeaf = null
    sharedRoot = null

    rmSync(join(root, 'sessions'), { recursive: true, force: true })
    rmSync(codexAppServerPid(root), { force: true })
    codexHarness.sharedRuntimes = originalSharedRuntimes
    codexHeadlessHarness.sharedRuntimes = originalHeadlessSharedRuntimes
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_PROJECT_ROOT: repoRoot() }
    for (const key of sessionIdentityEnvVars()) delete cleanEnv[key]
    staleBackend = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: cleanEnv })
    for (let i = 0; i < 50 && !processStartToken(staleBackend.pid!); i++) await new Promise((resolve) => setTimeout(resolve, 20))
    registerBackendInstance('superseded-instance', staleBackend.pid!, repoRoot())
    const backendReport = await collectResourceReport({ persist: false })
    const staleOwner = backendReport.owners.find((entry) => entry.kind === 'orphan' && entry.id === 'superseded-instance')
    assert.ok(staleOwner?.processes.some((proc) => proc.pid === staleBackend!.pid), 'superseded supervisor root stays attributable by its instance registry')
    unregisterBackendInstance('superseded-instance', staleBackend.pid!)
    const staleExited = once(staleBackend, 'exit')
    staleBackend.kill('SIGTERM')
    await staleExited
    staleBackend = null
  } finally {
    if (child?.pid && processStartToken(child.pid)) child.kill('SIGTERM')
    if (sessionLeaf?.pid && processStartToken(sessionLeaf.pid)) sessionLeaf.kill('SIGTERM')
    if (sharedRoot?.pid && processStartToken(sharedRoot.pid)) sharedRoot.kill('SIGTERM')
    if (staleBackend?.pid && processStartToken(staleBackend.pid)) staleBackend.kill('SIGTERM')
    codexHarness.sharedRuntimes = originalSharedRuntimes
    codexHeadlessHarness.sharedRuntimes = originalHeadlessSharedRuntimes
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
