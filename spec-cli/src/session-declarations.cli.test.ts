import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const STALE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CURRENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const THREAD = 'codex-thread-for-current-worker'

function recordPath(home: string, id: string): string {
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  return join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id, 'session.json')
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
  try {
    const stalePath = writeRecord(home, STALE, 'stale-thread')
    const currentPath = writeRecord(home, CURRENT, THREAD)
    const staleBefore = readFileSync(stalePath, 'utf8')
    const note = 'need the current worker identity'
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SPEXCODE_HOME: home,
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
    const current = JSON.parse(readFileSync(currentPath, 'utf8'))
    assert.equal(current.status, 'asking')
    assert.equal(current.proposal, '')
    assert.equal(current.note, note)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the CLI hub reaches ask through the lazy declaration handler', () => {
  const source = readFileSync(cli, 'utf8')
  assert.match(source, /sub === 'done' \|\| sub === 'park' \|\| sub === 'ask'\) \{\n    const \{ runSessionDeclaration \} = await import\('\.\/session-declarations\.js'\)/)
  assert.doesNotMatch(source, /sub === 'ask'\) \{[\s\S]{0,1200}markState\('asking'/)
})
