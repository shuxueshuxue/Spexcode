import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

// The session-stamp hook (templates/hooks/prepare-commit-msg) runs on EVERY commit in EVERY repo it is
// installed in, under whatever env the shell happens to carry. A codex session injects CODEX_THREAD_ID into
// every command it spawns, so an ordinary repo routinely inherits a thread id that matches NO record in that
// repo's project store — that lookup must be a clean no-op, not an abort: the alias grep|head runs under the
// hook's `set -euo pipefail`, and a bare no-match assignment killed the hook (and the commit, exit 1 with no
// message — `--no-verify` does not skip prepare-commit-msg). These tests drive the REAL template through
// real `git commit`s.

const HOOK_TEMPLATE = fileURLToPath(new URL('../templates/hooks/prepare-commit-msg', import.meta.url))

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spex-stamp-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'])
  const hook = join(dir, '.git', 'hooks', 'prepare-commit-msg')
  copyFileSync(HOOK_TEMPLATE, hook)
  chmodSync(hook, 0o755)
  return dir
}

// the hook's own store derivation: <SPEXCODE_HOME>/projects/<dirname(abs git-common-dir), [/.] → ->
function projectStore(home: string, repo: string): string {
  const gcd = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return join(home, 'projects', dirname(gcd).replace(/[/.]/g, '-'))
}

function writeRecord(store: string, recordId: string, harnessSessionId: string): void {
  const dir = join(store, 'sessions', recordId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: recordId, governed: true, harness: 'codex', harness_session_id: harnessSessionId,
  }, null, 2))
}

// child env: strip the session vars this test process itself may have inherited (a claude- or
// codex-launched runner), then overlay the case's own.
function commitEnv(home: string, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CODEX_THREAD_ID
  delete env.SPEXCODE_SESSION_ID
  delete env.SPEXCODE_HOME
  return { ...env, SPEXCODE_HOME: home, ...extra }
}

let n = 0
function commit(repo: string, env: NodeJS.ProcessEnv, args: string[] = [], message = `c${++n}`) {
  writeFileSync(join(repo, 'f.txt'), `content ${n} ${Math.random()}`)
  execFileSync('git', ['-C', repo, 'add', 'f.txt'])
  return spawnSync('git', ['-C', repo, 'commit', ...args, '-m', message], { env, encoding: 'utf8' })
}

function lastMessage(repo: string): string {
  return execFileSync('git', ['-C', repo, 'log', '-1', '--format=%B'], { encoding: 'utf8' })
}

test('unmatched inherited CODEX_THREAD_ID is a clean no-op — commit succeeds, no Session trailer', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  const env = commitEnv(home, { CODEX_THREAD_ID: 'thread-foreign' })

  // shape 1: no sessions dir at all (the glob never expands — grep exit 2)
  let r = commit(repo, env, ['--no-verify'])
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(repo), /^Session:/im)

  // shape 2: the store HAS records, none carrying this thread id (grep no-match — exit 1)
  writeRecord(projectStore(home, repo), 'rec-other', 'thread-other')
  r = commit(repo, env, ['--no-verify'])
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.doesNotMatch(msg, /^Session:/im)          // no empty trailer,
  assert.ok(!msg.includes('thread-foreign'))       // no foreign thread id,
  assert.ok(!msg.includes('rec-other'))            // no stranger record either
})

test('matched alias stamps the RECORD id, never the raw thread id', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  writeRecord(projectStore(home, repo), 'rec-B', 'thread-B')
  const r = commit(repo, commitEnv(home, { CODEX_THREAD_ID: 'thread-B' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.match(msg, /^Session: rec-B$/m)
  assert.ok(!msg.includes('thread-B'))
})

test('a record keyed directly by the thread id stamps that id', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  writeRecord(projectStore(home, repo), 'thread-direct', 'thread-direct')
  const r = commit(repo, commitEnv(home, { CODEX_THREAD_ID: 'thread-direct' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(repo), /^Session: thread-direct$/m)
})

test('claude stamping is untouched: CLAUDE_CODE_SESSION_ID is the record id, stamped directly', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  // even alongside a foreign CODEX_THREAD_ID — claude's exported id wins the precedence
  const r = commit(repo, commitEnv(home, { CLAUDE_CODE_SESSION_ID: 'claude-rec', CODEX_THREAD_ID: 'thread-foreign' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(repo), /^Session: claude-rec$/m)
})

test('an existing Session: trailer is left alone — no restamp, no duplicate', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  const env = commitEnv(home, { CLAUDE_CODE_SESSION_ID: 'claude-rec' })
  const r = commit(repo, env, [], 'explicit\n\nSession: hand-set')
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.match(msg, /^Session: hand-set$/m)
  assert.equal(msg.match(/^Session:/gim)?.length, 1)
})

test('no session env at all is the plain no-op', () => {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  const r = commit(repo, commitEnv(home, {}))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(repo), /^Session:/im)
})
