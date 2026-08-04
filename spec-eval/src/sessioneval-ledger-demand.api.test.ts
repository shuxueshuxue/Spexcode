import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'

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

test('a public scoped eval demand does not wait for an unrelated live event-ledger writer', { timeout: 45_000 }, async () => {
  assert.match(process.version, /^v22\./, `ledger-demand API rig must run on Node 22, got ${process.version}`)
  assert.equal(git(SOURCE, 'status', '--porcelain=v1', '--untracked-files=all'), '', 'product checkout must be clean')
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

    const port = await freePort()
    backend = spawn(process.execPath, ['--import', 'tsx', join(SOURCE, 'spec-cli/src/index.ts')], {
      cwd: project,
      env: { ...childEnv, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backend.stderr!.on('data', (chunk) => { backendStderr += chunk.toString() })
    const origin = `http://127.0.0.1:${port}`
    let healthy = false
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        if ((await fetch(`${origin}/health`)).ok) { healthy = true; break }
      } catch { /* backend is starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(healthy, true, `backend failed to start: ${backendStderr.slice(-1200)}`)

    const holder = [
      `import { existsSync, writeFileSync } from 'node:fs'`,
      `import { withEventLedgerBuild } from ${JSON.stringify(join(SOURCE, 'spec-cli/src/git.ts'))}`,
      `await withEventLedgerBuild(process.cwd(), async () => {`,
      `  writeFileSync(${JSON.stringify(writerReady)}, JSON.stringify({ pid: process.pid }))`,
      `  while (!existsSync(${JSON.stringify(writerRelease)})) await new Promise((resolve) => setTimeout(resolve, 10))`,
      `})`,
    ].join('\n')
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

    const started = Date.now()
    const response = await fetch(`${origin}/api/evals?q=${encodeURIComponent(`is:eval scope:${SESSION_ID}`)}`)
    const raw = await response.text()
    const elapsedMs = Date.now() - started
    let body: any = null
    try { body = JSON.parse(raw) } catch { /* raw body is retained below */ }
    const observation = {
      phase: 'live-writer-public-demand',
      runtime: process.version,
      status: response.status,
      elapsedMs,
      writerHeld: existsSync(writerReady) && !existsSync(writerRelease) && writer.exitCode === null,
      rows: Array.isArray(body?.items) ? body.items.length : null,
      error: response.ok ? null : (body?.error ?? raw.slice(0, 1000)),
    }
    console.log(JSON.stringify(observation))
    assert.equal(observation.writerHeld, true, 'the product response must be measured while the unrelated writer still owns the transaction')
    assert.equal(response.status, 200, `foreground eval demand waited for the live writer: ${JSON.stringify(observation)}\n${backendStderr.slice(-1500)}`)
    assert.ok(Array.isArray(body?.items) && body.items.some((item: any) => item.scenario === 'value-moves'), 'the response must carry the selected scenario rather than an empty fallback')
  } finally {
    try { writeFileSync(writerRelease, 'release\n') } catch { /* fixture setup may have failed before creation */ }
    await stop(writer)
    await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
