import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { archiveSession, closeSession } from './sessions.js'
import { codexLoadedReferenceIds, codexStartThread, codexTurn } from './harness.js'
import { bindCodexGeneration, ensureCodexCurrentGeneration, legacyCodexGenerationEndpoint, readCodexGenerationLedger, resolveCodexGenerationForSession, type CodexGenerationEndpoint } from './codex-runtime-generations.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'
import { processStartToken } from './process-identity.js'
import { runtimeRoot, sessionRecordPath, sessionStoreDir } from './layout.js'

const enabled = process.env.SPEXCODE_CODEX_YATU === '1'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function startRealCodex(endpoint: CodexGenerationEndpoint, cwd: string, codexHome: string): Promise<void> {
  const binary = process.env.SPEXCODE_CODEX_BIN || 'codex'
  await spawnDetachedRuntime({
    cwd,
    logFile: endpoint.logFile,
    pidFile: endpoint.pidFile,
    receiptFile: endpoint.receiptFile,
    command: binary,
    args: ['app-server', '--listen', `unix://${endpoint.socketPath}`],
    env: { ...process.env, CODEX_HOME: codexHome },
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    const census = await codexLoadedReferenceIds(endpoint.socketPath)
    if (census.ok) return
    await sleep(25)
  }
  throw new Error(`real Codex app-server did not become ready at ${endpoint.socketPath}`)
}

function writeRecord(id: string, threadId: string, worktree: string, branch: string, status = 'idle'): void {
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch, node: 'shared-runtime-generation-rotation',
    title: id, name: '', parent: '', status, proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(),
    harness: 'codex', harness_session_id: threadId, stopped: false, archived: false, cold_proof: '', adapter_recovery: '',
    launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
  }, null, 2)}\n`)
}

test('YATU: real Codex legacy 22/13/9 generation switch preserves protected refs and closes one exact target', { concurrency: false, timeout: 120_000, skip: !enabled }, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousCodexHome = process.env.CODEX_HOME
  const previousPath = process.env.PATH
  const previousCwd = process.cwd()
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-generation-yatu-'))
  const project = join(home, 'project')
  const codexHome = join(home, 'codex-home')
  const fakeBin = join(home, 'bin')
  const endpoints: CodexGenerationEndpoint[] = []
  try {
    mkdirSync(project, { recursive: true }); mkdirSync(codexHome); mkdirSync(fakeBin)
    copyFileSync(join(homedir(), '.codex', 'auth.json'), join(codexHome, 'auth.json'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    execFileSync('git', ['-c', 'user.name=yatu', '-c', 'user.email=yatu@example.test', 'commit', '--allow-empty', '-qm', 'seed'], { cwd: project })
    writeFileSync(join(fakeBin, 'tmux'), '#!/usr/bin/env sh\nexit 0\n')
    chmodSync(join(fakeBin, 'tmux'), 0o755)
    process.env.SPEXCODE_HOME = home
    process.env.CODEX_HOME = codexHome
    process.env.PATH = `${fakeBin}:${previousPath}`
    process.chdir(project)
    const root = runtimeRoot()
    const legacy = legacyCodexGenerationEndpoint(root)
    endpoints.push(legacy)
    await startRealCodex(legacy, project, codexHome)

    const threadIds: string[] = []
    for (let n = 0; n < 22; n++) {
      const started = await codexStartThread(legacy.socketPath, project)
      assert.equal(started.ok, true)
      if (started.ok) threadIds.push(started.threadId)
    }
    assert.equal(threadIds.length, 22)
    const governed = threadIds.slice(0, 13)
    const protectedUnowned = threadIds.slice(13)
    const target = 'generation-target'
    const branch = 'node/generation-target'
    const worktree = join(home, 'target-worktree')
    execFileSync('git', ['worktree', 'add', '-q', '-b', branch, worktree, 'main'], { cwd: project })
    for (const [index, threadId] of governed.entries()) {
      const id = index === 0 ? target : `protected-${index}`
      writeRecord(id, threadId, index === 0 ? worktree : join(home, `protected-${index}-worktree`), index === 0 ? branch : '', index < 5 ? 'active' : 'idle')
    }

    const current = await ensureCodexCurrentGeneration(root, async (endpoint) => {
      endpoints.push(endpoint)
      await startRealCodex(endpoint, project, codexHome)
    })
    const ledger = readCodexGenerationLedger(root)
    assert.equal(ledger.current, current.id)
    assert.equal(ledger.generations.legacy?.state, 'draining')
    assert.equal(Object.keys(ledger.bindings).length, 13)
    assert.equal(resolveCodexGenerationForSession(root, target, governed[0]!)?.id, 'legacy')

    const newThread = await codexStartThread(current.socketPath, project)
    if (!newThread.ok) throw new Error(newThread.error)
    assert.equal(newThread.ok, true)
    bindCodexGeneration(root, 'new-current', newThread.threadId, current.id)
    assert.equal(resolveCodexGenerationForSession(root, 'new-current', newThread.threadId)?.id, current.id)

    const beforeArchive = await codexLoadedReferenceIds(legacy.socketPath)
    if (!beforeArchive.ok) throw new Error(beforeArchive.error)
    assert.equal(beforeArchive.ok, true)
    assert.equal(beforeArchive.referenceIds.length, 22)
    const seeded = await codexTurn(legacy.socketPath, governed[0]!, 'Reply with exactly OK.', project)
    if (!seeded.ok) throw new Error(seeded.error)
    let archived = false
    let archiveError = ''
    for (let attempt = 0; attempt < 60; attempt++) {
      try { archived = await archiveSession(target) }
      catch (error) { archiveError = error instanceof Error ? error.message : String(error) }
      if (archived) break
      await sleep(1000)
    }
    assert.equal(archived, true, archiveError || 'target did not become archivable')
    const afterArchive = await codexLoadedReferenceIds(legacy.socketPath)
    if (!afterArchive.ok) throw new Error(afterArchive.error)
    assert.equal(afterArchive.ok, true)
    assert.equal(afterArchive.referenceIds.includes(governed[0]!), false)
    assert.ok(protectedUnowned.every((threadId) => afterArchive.referenceIds.includes(threadId)), 'all 9 unowned references survive target archive')
    assert.ok(governed.slice(1, 6).every((threadId) => afterArchive.referenceIds.includes(threadId)), 'five protected governed sessions survive target archive')
    assert.equal(await closeSession(target), true)
    assert.equal(existsSync(sessionStoreDir(target)), false)
    assert.equal(existsSync(worktree), false)
    const afterClose = await codexLoadedReferenceIds(legacy.socketPath)
    if (!afterClose.ok) throw new Error(afterClose.error)
    assert.equal(afterClose.ok, true)
    assert.ok(protectedUnowned.every((threadId) => afterClose.referenceIds.includes(threadId)), 'close did not remove unowned legacy references')
  } finally {
    for (const endpoint of endpoints) {
      let pid = 0
      try { pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim()) } catch { /* absent */ }
      if (pid > 0 && processStartToken(pid)) { try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ } }
    }
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodexHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
  }
})
