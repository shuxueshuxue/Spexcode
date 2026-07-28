import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexAppServerReceipt, codexAppServerPid, codexHarness, codexHeadlessHarness, sessionIdentityEnvVars, type SharedRuntimeProbe } from './harness.js'
import { repoRoot } from './git.js'
import { runtimeRoot } from './layout.js'
import {
  assertSessionStopSafe,
  collectResourceReport,
} from './host-resources.js'
import { parseProcStat, processStartToken, verifyDetachedRuntime, writeDetachedRuntimeReceipt } from './process-identity.js'
import { registerBackendInstance, spawnDetachedRuntime, unregisterBackendInstance } from './runtime-ownership.js'

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
  const receiptFile = join(root, 'runtime.detached.json')
  let identity: { pid: number; startToken: string } | null = null
  try {
    identity = spawnDetachedRuntime({
      cwd: root,
      logFile: join(root, 'runtime.log'),
      pidFile,
      receiptFile,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    const detached = verifyDetachedRuntime(identity.pid, receiptFile)
    assert.equal(detached.ok, true)
    if (detached.ok) assert.deepEqual(detached.identity, {
      ...identity,
      receiptVersion: 4,
      processGroupId: identity.pid,
      ...(platform() === 'linux' ? { linuxSessionId: identity.pid } : {}),
    })
    assert.equal(readFileSync(pidFile, 'utf8'), `${identity.pid}\n`)
    assert.equal(JSON.parse(readFileSync(receiptFile, 'utf8')).version, 4)
  } finally {
    if (identity && processStartToken(identity.pid) === identity.startToken) {
      try { process.kill(identity.pid, 'SIGTERM') } catch {}
      for (let i = 0; i < 50 && processStartToken(identity.pid) === identity.startToken; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    }
    rmSync(root, { recursive: true, force: true })
  }
})

test('session stop guard reads only the exact governed target and fails closed on target ambiguity', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const originalSharedRuntimes = codexHarness.sharedRuntimes
  const home = mkdtempSync(join(tmpdir(), 'spex-target-scoped-stop-home-'))
  process.env.SPEXCODE_HOME = home
  const root = runtimeRoot()
  const runtime = join(home, 'shared-runtime')
  mkdirSync(root, { recursive: true })
  mkdirSync(runtime, { recursive: true })
  const pidFile = join(runtime, 'shared.pid')
  const receiptFile = join(runtime, 'shared.detached.json')
  const identity = spawnDetachedRuntime({
    cwd: runtime,
    logFile: join(runtime, 'shared.log'),
    pidFile,
    receiptFile,
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
  })
  const targetLeaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  for (let i = 0; i < 50 && !processStartToken(targetLeaf.pid!); i++) await new Promise((resolve) => setTimeout(resolve, 20))
  const targetLeafStart = processStartToken(targetLeaf.pid!)
  assert.ok(targetLeafStart)
  const target = 'target-scoped-stop'
  const targetThread = 'target-scoped-thread'
  const recordDir = join(root, 'sessions', target)
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(join(recordDir, 'session.json'), `${JSON.stringify({
    session_id: target, governed: true, worktree_path: root, branch: 'node/target-scoped-stop', node: null,
    title: null, name: null, parent: null, status: 'awaiting', proposal: 'nothing', merges: 0, note: null,
    sortkey: null, createdAt: Date.now(), harness: 'codex', harness_session_id: targetThread, stopped: false,
    archived: false, launcher: 'codex', launch_cmd: 'codex --yolo',
  }, null, 2)}\n`)
  let mode: 'idle' | 'active' | 'unknown' | 'descendant' = 'idle'
  let loadedIdCensuses = 0
  let exactTargetReads = 0
  let activeDescendantCensuses = 0
  let archivedDescendantCensuses = 0
  let fullSiblingReads = 0
  let replaceReceiptDuringGuard = false
  const coldReceipt = { fixture: 'adapter-owned-cold-receipt' }
  const descriptor = {
    key: 'codex-app-server',
    label: 'Codex app-server',
    pidFile,
    receiptFile,
    residency: async () => ({ healthy: true, referenceIds: [targetThread, 'slow-unrelated-sibling'] }),
    mutationGuard: async (threadId: string | null, opts?: { coldReceipt?: unknown }) => {
      assert.equal(threadId, targetThread)
      loadedIdCensuses++
      exactTargetReads++
      activeDescendantCensuses++
      archivedDescendantCensuses++
      if (replaceReceiptDuringGuard) writeFileSync(receiptFile, '{"version":999}\n')
      return {
        healthy: mode !== 'unknown',
        referenceIds: [targetThread, 'slow-unrelated-sibling'],
        targetTurnPresence: mode === 'active' ? 'active' : mode === 'unknown' ? 'unknown' : 'idle',
        descendantIds: mode === 'descendant' ? ['owned-native-child'] : [],
        coldTeardownAuthorized: mode === 'descendant' && opts?.coldReceipt === coldReceipt,
        ...(mode === 'unknown' ? { error: 'exact target turn state is unknown' } : {}),
      }
    },
    probe: async () => {
      fullSiblingReads++
      return new Promise<SharedRuntimeProbe>(() => {})
    },
  }
  codexHarness.sharedRuntimes = () => [descriptor as any]
  try {
    const result = await Promise.race([
      assertSessionStopSafe(target, { session: target, harness: 'codex' }).then(() => 'safe'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out-on-full-projection'), 100)),
    ])
    assert.equal(result, 'safe')
    assert.deepEqual({ loadedIdCensuses, exactTargetReads, activeDescendantCensuses, archivedDescendantCensuses }, {
      loadedIdCensuses: 1, exactTargetReads: 1, activeDescendantCensuses: 1, archivedDescendantCensuses: 1,
    })
    assert.equal(fullSiblingReads, 0, 'stop safety never enters the full sibling turn projection')

    const restoreIdentity = () => {
      writeFileSync(pidFile, `${identity.pid}\n`)
      writeDetachedRuntimeReceipt(identity.pid, receiptFile)
    }
    const refuseIdentity = async (name: string, setup: () => void, reason: RegExp) => {
      restoreIdentity()
      setup()
      const proofCallsBefore = loadedIdCensuses
      await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), reason)
      assert.equal(loadedIdCensuses, proofCallsBefore, `${name} refuses before the adapter guard`)
      assert.equal(processStartToken(identity.pid), identity.startToken, `${name} sends no signal to the shared root`)
      assert.equal(processStartToken(targetLeaf.pid!), targetLeafStart, `${name} sends no signal to the target leaf`)
    }
    await refuseIdentity('missing PID', () => rmSync(pidFile, { force: true }), /no readable owner PID/)
    await refuseIdentity('dead PID', () => writeFileSync(pidFile, '999999999\n'), /receipt names PID|no readable process-start identity/)
    await refuseIdentity('missing receipt', () => rmSync(receiptFile, { force: true }), /no matching live detached process-boundary record/)
    await refuseIdentity('mismatched start', () => {
      const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))
      receipt.startToken = 'wrong'
      writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`)
    }, /no matching live detached process-boundary record/)
    await refuseIdentity('arbitrary receipt', () => writeFileSync(receiptFile, `fixture ${identity.pid}\n`), /no matching live detached process-boundary record/)
    await refuseIdentity('non-detached topology', () => {
      const pid = targetLeaf.pid!
      const start = processStartToken(pid)!
      writeFileSync(pidFile, `${pid}\n`)
      writeFileSync(receiptFile, `${JSON.stringify({
        version: 4, kind: 'spexcode-detached-runtime', pid, startToken: start, processGroupId: pid,
        ...(platform() === 'linux' ? { linuxSessionId: pid } : {}),
      })}\n`)
    }, /no matching live detached process-boundary record/)
    restoreIdentity()

    replaceReceiptDuringGuard = true
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }),
      /PID\/start\/detached-receipt identity changed during target-scoped mutation guard/)
    replaceReceiptDuringGuard = false
    restoreIdentity()

    for (const [next, reason] of [['unknown', /target turn state is unknown/], ['active', /active turn/], ['descendant', /owned descendants.*owned-native-child/]] as const) {
      mode = next
      await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), reason)
      assert.equal(processStartToken(identity.pid), identity.startToken, `${next} refusal sends no signal to the shared root`)
      assert.equal(processStartToken(targetLeaf.pid!), targetLeafStart, `${next} refusal sends no signal to the target leaf`)
    }
    mode = 'descendant'
    await assert.doesNotReject(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }, { coldReceipt }),
      'archive may pass an already-proven exact descendant collection to the adapter cold commit')
    for (const next of ['unknown', 'active'] as const) {
      mode = next
      await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }, { coldReceipt }),
        next === 'unknown' ? /target turn state is unknown/ : /active turn/)
    }
  } finally {
    codexHarness.sharedRuntimes = originalSharedRuntimes
    if (processStartToken(identity.pid) === identity.startToken) {
      try { process.kill(identity.pid, 'SIGTERM') } catch {}
      for (let i = 0; i < 50 && processStartToken(identity.pid) === identity.startToken; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (targetLeaf.pid && processStartToken(targetLeaf.pid)) {
      try { targetLeaf.kill('SIGTERM') } catch {}
      for (let i = 0; i < 50 && processStartToken(targetLeaf.pid); i++) await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('resource report retains the full shared projection and reports its sibling timeout', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const originalSharedRuntimes = codexHarness.sharedRuntimes
  const home = mkdtempSync(join(tmpdir(), 'spex-full-resource-projection-'))
  process.env.SPEXCODE_HOME = home
  const root = runtimeRoot()
  const id = 'full-resource-projection'
  const recordDir = join(root, 'sessions', id)
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(join(recordDir, 'session.json'), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: root, branch: 'node/full-resource-projection', node: null,
    title: null, name: null, parent: null, status: 'awaiting', proposal: 'nothing', merges: 0, note: null,
    sortkey: null, createdAt: Date.now(), harness: 'codex', harness_session_id: 'resource-target-thread',
    stopped: false, archived: false, launcher: 'codex', launch_cmd: 'codex --yolo',
  }, null, 2)}\n`)
  let residencyCalls = 0
  let siblingThreadReads = 0
  codexHarness.sharedRuntimes = () => [{
    key: 'codex-app-server', label: 'Codex app-server', pidFile: join(home, 'missing.pid'),
    receiptFile: join(home, 'missing.detached.json'),
    residency: async () => { residencyCalls++; return { healthy: true, referenceIds: ['slow-unrelated-sibling'] } },
    probe: async () => {
      siblingThreadReads++
      return { healthy: false, references: [], error: 'codex app-server ownership probe timed out after 5000ms' }
    },
  }]
  try {
    const report = await collectResourceReport({ persist: false })
    const shared = report.owners.find((owner) => owner.kind === 'shared-runtime' && owner.id === 'codex-app-server')
    assert.equal(siblingThreadReads, 1, 'resources still performs the full per-thread ownership projection')
    assert.equal(residencyCalls, 0, 'resources does not substitute the mutation/read-projection census')
    assert.equal(shared?.controlPlane?.healthy, false)
    assert.match(shared?.controlPlane?.error || '', /ownership probe timed out after 5000ms/)
  } finally {
    codexHarness.sharedRuntimes = originalSharedRuntimes
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
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
    const fallbackSharedRuntimes = (runtimeDir: string) => originalSharedRuntimes!(runtimeDir).map((descriptor) => ({ ...descriptor, mutationGuard: undefined, probe: async () => probe }))
    codexHarness.sharedRuntimes = fallbackSharedRuntimes
    codexHeadlessHarness.sharedRuntimes = fallbackSharedRuntimes

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
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /no matching live detached process-boundary record/)
    writeFileSync(codexAppServerPid(root), `${sharedRoot.pid}\n`)
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /no matching live detached process-boundary record/)
    writeDetachedRuntimeReceipt(sharedRoot.pid!, codexAppServerReceipt(root))
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
    await assert.rejects(() => assertSessionStopSafe(target, { session: target, harness: 'codex' }), /no matching live detached process-boundary record/)
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
