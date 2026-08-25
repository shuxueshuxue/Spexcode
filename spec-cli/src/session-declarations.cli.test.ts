import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeFreshSessionApplication } from './session-application.js'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const STALE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CURRENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const THREAD = 'codex-thread-for-current-worker'

function recordPath(home: string, id: string, cwd = pkgRoot): string {
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim())
  return join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id, 'runtime.json')
}

function writeRecord(home: string, id: string, harnessSessionId: string): string {
  const path = recordPath(home, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    session_id: id, governed: true, worktree_path: dirname(pkgRoot), branch: `node/${id}`, node: null,
    title: 'declaration fixture', name: '', parent: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: Date.now(), harness: 'codex', harness_session_id: harnessSessionId, stopped: false,
    archived: false, launcher: 'fixture', launch_cmd: 'true',
  }, null, 2)}\n`)
  return path
}

test('session ask keeps its receipt and attributes a shared Codex worker to its injected thread', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-session-declarations-'))
  const previousHome = process.env.SPEXCODE_HOME
  const previousDatabasePath = process.env.SPEX_SESSION_DATABASE_PATH
  try {
    process.env.SPEXCODE_HOME = home
    process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
    const application = initializeFreshSessionApplication()
    const stalePath = writeRecord(home, STALE, 'stale-thread')
    const currentPath = writeRecord(home, CURRENT, THREAD)
    application.createSession({ sessionId: STALE, status: 'active' })
    application.createSession({ sessionId: CURRENT, status: 'active' })
    const staleBefore = readFileSync(stalePath, 'utf8')
    const note = 'need the current worker identity'
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SPEXCODE_HOME: home,
      SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'),
      // The shared Codex app-server inherited this from another worker. CODEX_THREAD_ID is the acting worker.
      SPEXCODE_SESSION_ID: STALE,
      CODEX_THREAD_ID: THREAD,
    }
    for (const key of ['CLAUDE_CODE_SESSION_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]

    const result = spawnSync('tsx', [cli, 'session', 'ask', '--note', note], { cwd: pkgRoot, encoding: 'utf8', env })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout, 'asking — recorded; the human sees it in the dashboard. This declaration remains in the session timeline; your next tool call flips only the current graph state back to active (the mark-active hook, by design).\n')
    assert.equal(readFileSync(stalePath, 'utf8'), staleBefore, 'the contaminated shared env record is untouched')
    const current = application.readState(CURRENT)
    assert.equal(current?.status, 'asking')
    assert.equal(current?.proposal, null)
    assert.equal(current?.note, note)
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousDatabasePath === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabasePath
    rmSync(home, { recursive: true, force: true })
  }
})

test('the CLI hub reaches ask through the lazy declaration handler', () => {
  const source = readFileSync(cli, 'utf8')
  assert.match(source, /sub === 'done' \|\| sub === 'park' \|\| sub === 'ask'\) \{\n    const \{ runSessionDeclaration \} = await import\('\.\/session-declarations\.js'\)/)
  assert.doesNotMatch(source, /sub === 'ask'\) \{[\s\S]{0,1200}markState\('asking'/)
})

test('merge declaration records without the removed acceptance configuration', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-merge-declaration-'))
  const home = join(fixture, 'home')
  const root = join(fixture, 'repo')
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const previousHome = process.env.SPEXCODE_HOME
  const previousDatabasePath = process.env.SPEX_SESSION_DATABASE_PATH
  try {
    process.env.SPEXCODE_HOME = home
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'spexcode.json'), '{}\n')
    writeFileSync(join(root, 'README.md'), 'fixture\n')
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'merge-declaration@example.test'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Merge Declaration'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
    execFileSync('git', ['switch', '-qc', `node/${id}`], { cwd: root })
    writeFileSync(join(root, 'landed.txt'), 'ready\n')
    execFileSync('git', ['add', 'landed.txt'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'landed'], { cwd: root })

    process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
    const application = initializeFreshSessionApplication()
    const path = recordPath(home, id, root)
    const config = JSON.parse(readFileSync(join(root, 'spexcode.json'), 'utf8')) as Record<string, unknown>
    assert.equal(config.review, undefined, 'the project config no longer carries the removed review gate')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({
      session_id: id, governed: true, worktree_path: root, branch: `node/${id}`, node: null,
      title: 'merge declaration', name: '', parent: null, status: 'active', proposal: null, merges: 0, note: null,
      sortkey: null, createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
      archived: false, launcher: 'fixture', launch_cmd: 'true',
    }, null, 2)}\n`)
    application.createSession({ sessionId: id, status: 'active' })
    const result = spawnSync('tsx', [cli, 'session', 'done', '--propose', 'merge', '--note', 'ready'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'), SPEXCODE_SESSION_ID: id },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /done \(merge\).*recorded/)
    const row = application.readState(id)
    assert.deepEqual({ status: row?.status, proposal: row?.proposal, note: row?.note }, { status: 'awaiting', proposal: 'merge', note: 'ready' })
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousDatabasePath === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabasePath
    rmSync(fixture, { recursive: true, force: true })
  }
})
