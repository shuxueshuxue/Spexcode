import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { processStartToken } from '@spexcode/spec-core'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SESSION_ID = 'eval-ledger-demand-0001'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const done = once(child, 'exit')
  const timedOut = await Promise.race([
    done.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])
  if (timedOut) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

function record(home: string, project: string, worktree: string): void {
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', SESSION_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: SESSION_ID,
    governed: true,
    worktree_path: worktree,
    branch: 'node/eval-ledger-demand',
    node: 'eval-ledger-demand-fixture',
    title: 'eval ledger demand fixture',
    name: '',
    parent: null,
    status: 'active',
    proposal: '',
    merges: 0,
    note: '',
    sortkey: '',
    createdAt: Date.now(),
    harness: 'claude',
    harness_session_id: '',
    launcher: 'fixture',
    launch_cmd: 'true',
  }, null, 2) + '\n')
}

test('public eval surfaces share one ledger truth without inheriting writer lock wall time', { timeout: 90_000 }, async () => {
  assert.match(process.version, /^v22\./, `ledger-demand API rig must run on Node 22, got ${process.version}`)
  console.log(JSON.stringify({
    phase: 'provenance',
    runtime: process.version,
    productSha: git(SOURCE, 'rev-parse', 'HEAD'),
    productDirty: git(SOURCE, 'status', '--porcelain=v1', '--untracked-files=all') !== '',
  }))
  const fixture = mkdtempSync(join(tmpdir(), 'spex-eval-ledger-demand-'))
  const project = join(fixture, 'project')
  const worktree = join(fixture, 'worktree')
  const home = join(fixture, 'home')
  const writerReady = join(fixture, 'writer-ready')
  const writerRelease = join(fixture, 'writer-release')
  const deps = [join(SOURCE, 'node_modules'), join(dirname(git(SOURCE, 'rev-parse', '--path-format=absolute', '--git-common-dir')), 'node_modules')]
    .find(existsSync)
  if (!deps) throw new Error('ledger-demand API rig requires installed dependencies')
  let backend: ChildProcess | null = null
  let writer: ChildProcess | null = null
  let backendStderr = ''
  let writerStderr = ''
  try {
    mkdirSync(project, { recursive: true })
    symlinkSync(deps, join(project, 'node_modules'), 'dir')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'eval@example.test')
    git(project, 'config', 'user.name', 'Eval Test')
    mkdirSync(join(project, '.spec/project/eval-ledger-demand-fixture'), { recursive: true })
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')
    writeFileSync(join(project, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(project, '.spec/project/eval-ledger-demand-fixture/spec.md'), [
      '---', 'title: eval-ledger-demand-fixture', 'code:', '  - src/value.ts',
      '---', '# eval ledger demand fixture', '',
    ].join('\n'))
    writeFileSync(join(project, '.spec/project/eval-ledger-demand-fixture/eval.md'), [
      '---', 'scenarios:', '  - name: value-moves', '    tags: [backend-api]',
      '    code: [src/value.ts]', '    description: change the value', '    expected: changed value is in scope',
      '---', 'fixture', '',
    ].join('\n'))
    writeFileSync(join(project, 'src/value.ts'), 'export const value = 1\n')
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'fixture base')
    git(project, 'worktree', 'add', '-q', '-b', 'node/eval-ledger-demand', worktree, 'main')
    writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 2\n')
    git(worktree, 'add', 'src/value.ts')
    git(worktree, 'commit', '-qm', 'change value')
    record(home, project, worktree)

    const scrubbed = [
      'SPEXCODE_ROOT', 'SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'SPEXCODE_INSTANCE_ID',
      'SPEXCODE_PASSWORD', 'SPEXCODE_CLAUDE_CMD', 'CLAUDE_CMD', 'CLAUDE_CODE_SESSION_ID',
      'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID', 'SPEXCODE_CODEX_CMD',
      'SPEXCODE_CODEX_SERVER_CMD', 'SPEXCODE_CODEX_SOCKET_DIR', 'SPEXCODE_OPENCODE_CONTINUE',
      'SPEXCODE_OPENCODE_RESUME_ID', 'SPEXCODE_PI_AGENT_DIR', 'SPEXCODE_ISSUES_DIR',
      'SPEXCODE_INDEX_CACHE_ROOTS', 'SPEXCODE_DASHBOARD_PORT', 'SPEXCODE_PUBLIC',
      'SPEXCODE_TLS_CERT', 'SPEXCODE_TLS_KEY', 'SPEXCODE_HOME', 'SPEXCODE_TMUX', 'PORT',
    ]
    const childEnv = { ...process.env }
    for (const key of scrubbed) delete childEnv[key]
    Object.assign(childEnv, {
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: 'eval-ledger-demand-none',
      SPEXCODE_GIT_TIMEOUT_MS: '1500',
    })

    let origin = ''
    const startBackend = async () => {
      const port = await freePort()
      backendStderr = ''
      backend = spawn(process.execPath, ['--import', 'tsx', join(SOURCE, 'spec-cli/src/index.ts')], {
        cwd: project,
        env: { ...childEnv, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      backend.stderr!.on('data', (chunk) => { backendStderr += chunk.toString() })
      origin = `http://127.0.0.1:${port}`
      let healthy = false
      for (let attempt = 0; attempt < 150; attempt++) {
        try {
          if ((await fetch(`${origin}/health`)).ok) { healthy = true; break }
        } catch { /* backend is starting */ }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.equal(healthy, true, `backend failed to start: ${backendStderr.slice(-1200)}`)
    }
    await startBackend()

    const ledgerFiles = () => readdirSync(home, { recursive: true })
      .map((entry) => String(entry))
      .filter((entry) => /history-events-v\d+-[0-9a-f]+\.ndjson$/.test(entry))
      .map((entry) => join(home, entry))
    const demand = async (signal?: AbortSignal) => {
      const response = await fetch(`${origin}/api/evals?q=${encodeURIComponent(`is:eval scope:${SESSION_ID}`)}`, { signal })
      const raw = await response.text()
      let body: any = null
      try { body = JSON.parse(raw) } catch { /* preserve the raw response for a loud assertion */ }
      return { response, raw, body }
    }
    const detailDemand = async () => {
      const response = await fetch(`${origin}/api/evals/detail?node=eval-ledger-demand-fixture&scenario=value-moves&scope=${SESSION_ID}`)
      const raw = await response.text()
      let body: any = null
      try { body = JSON.parse(raw) } catch { /* preserve the raw response for a loud assertion */ }
      return { response, raw, body }
    }

    const holder = [
      `import { existsSync, writeFileSync } from 'node:fs'`,
      `import { withEventLedgerBuild } from ${JSON.stringify(join(SOURCE, 'packages/spec-core/src/git.ts'))}`,
      `await withEventLedgerBuild(process.cwd(), async () => {`,
      `  writeFileSync(${JSON.stringify(writerReady)}, JSON.stringify({ pid: process.pid }))`,
      `  while (!existsSync(${JSON.stringify(writerRelease)})) await new Promise((resolve) => setTimeout(resolve, 10))`,
      `})`,
    ].join('\n')
    const startWriter = async () => {
      rmSync(writerReady, { force: true })
      rmSync(writerRelease, { force: true })
      writerStderr = ''
      writer = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', holder], {
        cwd: project,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      writer.stderr!.on('data', (chunk) => { writerStderr += chunk.toString() })
      let held = false
      for (let attempt = 0; attempt < 100; attempt++) {
        if (existsSync(writerReady)) { held = true; break }
        if (writer.exitCode !== null || writer.signalCode !== null) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.equal(held, true, `writer failed to acquire the ledger: ${writerStderr.slice(-1200)}`)
    }
    const releaseWriter = async () => {
      writeFileSync(writerRelease, 'release\n')
      await stop(writer)
      writer = null
    }

    await startWriter()

    const started = Date.now()
    const cold = await demand()
    const elapsedMs = Date.now() - started
    const observation = {
      phase: 'cold-review-payload-live-writer-demand',
      runtime: process.version,
      status: cold.response.status,
      elapsedMs,
      writerHeld: existsSync(writerReady) && !existsSync(writerRelease) && writer.exitCode === null,
      rows: Array.isArray(cold.body?.items) ? cold.body.items.length : null,
      error: cold.response.ok ? null : (cold.body?.error ?? cold.raw.slice(0, 1000)),
    }
    console.log(JSON.stringify(observation))
    assert.equal(observation.writerHeld, true, 'the product response must be measured while the unrelated writer still owns the transaction')
    assert.equal(cold.response.status, 200, `cold review payload waited for the live writer: ${JSON.stringify(observation)}\n${backendStderr.slice(-1500)}`)
    assert.ok(Array.isArray(cold.body?.items) && cold.body.items.some((item: any) => item.scenario === 'value-moves'), 'the response must carry the selected scenario rather than an empty fallback')
    assert.deepEqual(ledgerFiles(), [], 'cold read-only demand must not publish a writer-owned ledger')

    const detailStarted = Date.now()
    const detail = await detailDemand()
    const detailElapsedMs = Date.now() - detailStarted
    console.log(JSON.stringify({ phase: 'scoped-detail-live-writer-demand', status: detail.response.status, elapsedMs: detailElapsedMs }))
    assert.equal(detail.response.status, 200, `scoped detail failed while an unrelated writer was live: ${detail.raw.slice(0, 1200)}`)
    assert.equal(detail.body?.availability, 'unmeasured')
    assert.ok(detailElapsedMs < 10_000, `scoped detail inherited a writer/watch reconciliation wall: ${detailElapsedMs}ms`)

    await stop(backend)
    backend = null
    await startBackend()
    const exported = await fetch(`${origin}/api/sessions/${SESSION_ID}/evals?format=html`)
    const exportedHtml = await exported.text()
    assert.equal(exported.status, 200, `the public export surface inherited writer wall time: ${exportedHtml.slice(0, 1000)}`)
    assert.match(exportedHtml, /eval-ledger-demand-fixture/i)

    await releaseWriter()
    const graphWarm = await fetch(`${origin}/api/graph`)
    assert.equal(graphWarm.status, 200, `summary control could not establish its non-eval graph baseline: ${await graphWarm.text()}`)
    await startWriter()
    const streamAbort = new AbortController()
    const stream = await fetch(`${origin}/api/graph/stream?mode=delta`, { signal: streamAbort.signal })
    const reader = stream.body!.getReader()
    await reader.read()
    const summaryDemand = await demand()
    assert.equal(summaryDemand.response.status, 200, `summary projection demand failed under contention: ${summaryDemand.raw.slice(0, 1200)}`)
    let summaryReady = false
    let summaryPhase: string | null = null
    for (let attempt = 0; attempt < 80; attempt++) {
      const graphResponse = await fetch(`${origin}/api/graph`)
      const graph = await graphResponse.json() as any
      const row = graph?.sessions?.find((item: any) => item.id === SESSION_ID)
      summaryPhase = row?.evalSummary?.phase ?? null
      if (row?.evalSummary?.phase === 'ready' && row.evalSummary?.value?.total === 1) { summaryReady = true; break }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    streamAbort.abort()
    await reader.cancel().catch(() => {})
    assert.equal(summaryReady, true, `the graph summary surface did not settle while the independent ledger writer remained live (last phase: ${summaryPhase})\n${backendStderr.slice(-1500)}`)

    await releaseWriter()

    writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 3\n')
    git(worktree, 'add', 'src/value.ts')
    git(worktree, 'commit', '-qm', 'advance value for the first uncontended ledger')
    const uncontended = await demand()
    const files = ledgerFiles()
    const durableObservation = {
      phase: 'uncontended-demand-persists',
      status: uncontended.response.status,
      ledgerFiles: files.length,
      ledgerBytes: files.length === 1 ? statSync(files[0]).size : null,
      error: uncontended.response.ok ? null : uncontended.raw.slice(0, 1000),
    }
    console.log(JSON.stringify(durableObservation))
    assert.equal(uncontended.response.status, 200, `uncontended demand failed: ${JSON.stringify(durableObservation)}`)
    assert.equal(files.length, 1, 'an uncontended demand must retain the ordinary durable ledger transaction')
    assert.ok(statSync(files[0]).size > 0, 'the durable ledger replacement must contain derived facts')
    const ledger = files[0]
    const lock = `${ledger}.lock`

    mkdirSync(lock)
    writeFileSync(join(lock, 'owner.json'), '{"pid":"unknown"}\n')
    const replay = await demand()
    console.log(JSON.stringify({ phase: 'replay-does-not-enter-ledger-transaction', status: replay.response.status }))
    assert.equal(replay.response.status, 200, `a content-revision replay entered an unrelated lock: ${replay.raw.slice(0, 1200)}`)
    assert.equal(existsSync(lock), true, 'a replay never mutates an unknown lock')
    rmSync(lock, { recursive: true, force: true })

    writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 4\n')
    git(worktree, 'add', 'src/value.ts')
    git(worktree, 'commit', '-qm', 'advance value before contended corrupt snapshot')
    const corrupt = Buffer.from('corrupt-ledger-without-integrity\n')
    writeFileSync(ledger, corrupt)
    await startWriter()
    const contended = await demand()
    assert.equal(contended.response.status, 200, `corrupt contended snapshot failed to rebuild from Git: ${contended.raw.slice(0, 1200)}`)
    assert.deepEqual(readFileSync(ledger), corrupt, 'a contended corrupt snapshot rebuilds from Git without replacing the writer-owned ledger')
    await releaseWriter()

    writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 5\n')
    git(worktree, 'add', 'src/value.ts')
    git(worktree, 'commit', '-qm', 'replace corrupt snapshot without contention')
    const rebuilt = await demand()
    assert.equal(rebuilt.response.status, 200)
    assert.notDeepEqual(readFileSync(ledger), corrupt)

    const generationHolder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      const beforeGeneration = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 6\n')
      git(worktree, 'add', 'src/value.ts')
      git(worktree, 'commit', '-qm', 'advance value past stale writer generation')
      mkdirSync(lock)
      writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({
        pid: generationHolder.pid,
        token: 'legacy-reader-field',
        startToken: `not-${processStartToken(generationHolder.pid!)}`,
        nonce: randomUUID(),
      })}\n`)
      const reclaimed = await demand()
      const afterGeneration = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      console.log(JSON.stringify({ phase: 'stale-writer-generation', status: reclaimed.response.status, lockPresent: existsSync(lock) }))
      assert.equal(reclaimed.response.status, 200, `stale writer generation blocked demand: ${reclaimed.raw.slice(0, 1200)}`)
      assert.equal(existsSync(lock), false, 'a reused PID with the wrong process-start generation cannot retain the writer lock')
      assert.notEqual(afterGeneration, beforeGeneration, 'the reclaimed transaction persists the newly derived immutable facts')
    } finally {
      await stop(generationHolder)
      rmSync(lock, { recursive: true, force: true })
    }

    const reclaimer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      let reclaimerStart: string | null = null
      for (let attempt = 0; attempt < 50 && !(reclaimerStart = processStartToken(reclaimer.pid!)); attempt++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      assert.ok(reclaimerStart, 'stalled-reclaimer control acquired an exact process generation')
      const beforeReclaimer = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 7\n')
      git(worktree, 'add', 'src/value.ts')
      git(worktree, 'commit', '-qm', 'advance value while exact reclaimer owns dead-lock recovery')
      mkdirSync(lock)
      writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({ pid: 999_999_999, startToken: 'dead-owner', nonce: randomUUID() })}\n`)
      const reclaim = join(lock, 'reclaim')
      mkdirSync(reclaim)
      writeFileSync(join(reclaim, 'owner.json'), `${JSON.stringify({ pid: reclaimer.pid, startToken: reclaimerStart, nonce: randomUUID() })}\n`)
      const reclaimerStarted = Date.now()
      const bounded = await demand(AbortSignal.timeout(2_000))
      const reclaimerElapsedMs = Date.now() - reclaimerStarted
      const afterReclaimer = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      console.log(JSON.stringify({ phase: 'dead-owner-live-reclaimer', status: bounded.response.status, elapsedMs: reclaimerElapsedMs }))
      assert.equal(bounded.response.status, 200, `a live reclaimer made foreground demand spin: ${bounded.raw.slice(0, 1200)}`)
      assert.ok(reclaimerElapsedMs < 2_000, `foreground demand exceeded its bounded reclaimer window: ${reclaimerElapsedMs}ms`)
      assert.equal(existsSync(lock), true, 'foreground demand never displaces the exact live reclaimer')
      assert.equal(afterReclaimer, beforeReclaimer, 'reclaimer contention uses the read-only ledger path')
    } finally {
      await stop(reclaimer)
      rmSync(lock, { recursive: true, force: true })
    }

    if (process.platform !== 'win32') {
      const beforeReleaseRace = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 8\n')
      git(worktree, 'add', 'src/value.ts')
      git(worktree, 'commit', '-qm', 'advance value across normal lock release race')
      mkdirSync(lock)
      const fifo = join(lock, 'owner.json')
      execFileSync('mkfifo', [fifo])
      const owner = JSON.stringify({
        pid: process.pid,
        token: 'legacy-reader-field',
        startToken: processStartToken(process.pid),
        nonce: randomUUID(),
      })
      const releaseScript = [
        `const { closeSync, openSync, rmSync, writeFileSync } = require('node:fs')`,
        `const fd = openSync(${JSON.stringify(fifo)}, 'w')`,
        `writeFileSync(fd, ${JSON.stringify(owner)})`,
        `rmSync(${JSON.stringify(lock)}, { recursive: true, force: true })`,
        `closeSync(fd)`,
      ].join(';')
      const releaser = spawn(process.execPath, ['-e', releaseScript], { stdio: 'ignore' })
      try {
        const released = await demand()
        const afterReleaseRace = createHash('sha256').update(readFileSync(ledger)).digest('hex')
        console.log(JSON.stringify({ phase: 'normal-release-after-create-collision', status: released.response.status }))
        assert.equal(released.response.status, 200, `a normal lock release became an unknown-owner 500: ${released.raw.slice(0, 1200)}`)
        assert.equal(existsSync(lock), false)
        assert.notEqual(afterReleaseRace, beforeReleaseRace, 'the retried acquisition persists the new immutable facts')
      } finally {
        await stop(releaser)
        rmSync(lock, { recursive: true, force: true })
      }
    }

    let pidOnePermission: string | null = null
    try { process.kill(1, 0); pidOnePermission = 'allowed' }
    catch (error) { pidOnePermission = (error as NodeJS.ErrnoException).code ?? 'unknown' }
    const pidOneStart = processStartToken(1)
    if (pidOnePermission === 'EPERM' && pidOneStart) {
      const beforeEperm = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 9\n')
      git(worktree, 'add', 'src/value.ts')
      git(worktree, 'commit', '-qm', 'advance value under an exact EPERM writer identity')
      mkdirSync(lock)
      writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({ pid: 1, startToken: pidOneStart, nonce: randomUUID() })}\n`)
      const eperm = await demand()
      const afterEperm = createHash('sha256').update(readFileSync(ledger)).digest('hex')
      console.log(JSON.stringify({ phase: 'eperm-exact-writer-generation', status: eperm.response.status }))
      assert.equal(eperm.response.status, 200, `EPERM hid a readable exact writer generation: ${eperm.raw.slice(0, 1200)}`)
      assert.equal(existsSync(lock), true, 'an exact live EPERM writer retains its lock')
      assert.equal(afterEperm, beforeEperm, 'contended EPERM demand never replaces the writer-owned ledger')
      rmSync(lock, { recursive: true, force: true })
    }

    writeFileSync(join(worktree, 'src/value.ts'), 'export const value = 10\n')
    git(worktree, 'add', 'src/value.ts')
    git(worktree, 'commit', '-qm', 'advance value before unknown owner refusal')
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner.json'), '{"pid":1,"startToken":null,"nonce":"unknown"}\n')
    const beforeUnknown = createHash('sha256').update(readFileSync(ledger)).digest('hex')
    const unknown = await demand()
    const afterUnknown = createHash('sha256').update(readFileSync(ledger)).digest('hex')
    console.log(JSON.stringify({ phase: 'unknown-lock-owner', status: unknown.response.status }))
    assert.equal(unknown.response.status, 500, 'an unprovable lock owner must remain fail-loud')
    assert.match(backendStderr, /no provable exact owner|identity is unreadable/i)
    assert.equal(afterUnknown, beforeUnknown, 'an unknown lock owner cannot authorize ledger replacement')
    assert.equal(existsSync(lock), true, 'an unknown lock is preserved for diagnosis')
    rmSync(lock, { recursive: true, force: true })
  } finally {
    try { writeFileSync(writerRelease, 'release\n') } catch { /* fixture setup may have failed before creation */ }
    await stop(writer)
    await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
