import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync, spawn } from 'node:child_process'

// The session-stamp hook (templates/hooks/prepare-commit-msg) answers WHO is committing, from the environment
// — but an env var is only worth the reason it is there, and the hook checks that reason:
//   - CODEX_THREAD_ID is stamped by codex onto every command it spawns, so it names the ACTING thread and
//     cannot be a leftover: resolving it through the record's `harness_session_id` is the whole check.
//   - SPEXCODE_SESSION_ID (and claude/pi's exported ids) are INHERITED by every descendant, which is exactly
//     how they go stale — codex's shared app-server outlived its launching session and handed that id to
//     every later thread's `git commit` (github#76). So an inherited id is trusted only under DESCENT from
//     that session's own registered agent process (`agent.pid`).
// These tests drive the REAL template through real `git commit`s, with agent.pid pointed at this test process
// (every git child of it genuinely descends) or at an unrelated live process (it does not).

const HOOK_TEMPLATE = fileURLToPath(new URL('../templates/hooks/prepare-commit-msg', import.meta.url))

function bareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CODEX_THREAD_ID
  delete env.SPEXCODE_SESSION_ID
  delete env.PI_SESSION_ID
  delete env.OPENCODE_SESSION_ID
  delete env.SPEXCODE_HOME
  return env
}

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spex-stamp-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'])
  const hook = join(dir, '.git', 'hooks', 'prepare-commit-msg')
  copyFileSync(HOOK_TEMPLATE, hook)
  chmodSync(hook, 0o755)
  writeFileSync(join(dir, 'seed'), 'seed')
  execFileSync('git', ['-C', dir, 'add', '-A'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'seed'], { env: bareEnv() })
  return dir
}

// the hook's own store derivation: <SPEXCODE_HOME>/projects/<dirname(abs git-common-dir), [/.] → ->
function projectStore(home: string, repo: string): string {
  const gcd = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return join(home, 'projects', dirname(gcd).replace(/[/.]/g, '-'))
}

type Rec = { harness?: string; harnessSessionId?: string; agentPid?: number | string }
function writeRecord(store: string, id: string, rec: Rec = {}): void {
  const dir = join(store, 'sessions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: '/nowhere/in/particular', branch: null,
    status: 'active', harness: rec.harness ?? 'claude', harness_session_id: rec.harnessSessionId ?? '',
  }, null, 2))
  if (rec.agentPid !== undefined) writeFileSync(join(dir, 'agent.pid'), String(rec.agentPid))
}

function commitEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...bareEnv(), SPEXCODE_HOME: home, ...extra }
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

function rig(): { home: string; repo: string; store: string } {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  return { home, repo, store: projectStore(home, repo) }
}

// a live process that is NOT one of our ancestors — what a leaking daemon looks like from here
function stranger(t: { after: (fn: () => void) => void }): number {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' })
  t.after(() => child.kill())
  return child.pid!
}

test('an inherited id is stamped when this process DESCENDS from that session\'s agent', () => {
  const { home, repo, store } = rig()
  writeRecord(store, 'rec-mine', { agentPid: process.pid })     // every git child of this test descends from it
  const r = commit(repo, commitEnv(home, { SPEXCODE_SESSION_ID: 'rec-mine' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(repo), /^Session: rec-mine$/m)
})

test('the same id LEAKED into a stranger\'s process is refused — descent, not possession, is the proof', (t) => {
  const { home, repo, store } = rig()
  writeRecord(store, 'rec-leaker', { agentPid: stranger(t) })   // alive, real, and not our ancestor
  const msgEnvs = [
    { SPEXCODE_SESSION_ID: 'rec-leaker' },                      // the shared app-server's baked id (github#76)
    { CLAUDE_CODE_SESSION_ID: 'rec-leaker' },                   // a claude id inherited through some daemon
    { PI_SESSION_ID: 'rec-leaker' },
  ]
  for (const extra of msgEnvs) {
    const r = commit(repo, commitEnv(home, extra))
    assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
    const msg = lastMessage(repo)
    assert.doesNotMatch(msg, /^Session:/im, `stamped from ${JSON.stringify(extra)}`)
    assert.ok(!msg.includes('rec-leaker'))
  }
})

test('an id that names NO record is never stamped — a swept session leaves no ghost', () => {
  const { home, repo, store } = rig()
  const env = commitEnv(home, {
    SPEXCODE_SESSION_ID: '7ed51371-cece-4f27-9891-0e1c330c587c',   // the github#76 ghost: record long swept
    CLAUDE_CODE_SESSION_ID: '7ed51371-cece-4f27-9891-0e1c330c587c',
    CODEX_THREAD_ID: 'thread-of-nobody',
  })
  // shape 1: no sessions dir at all — the glob never expands (grep exit 2)
  let r = commit(repo, env, ['--no-verify'])                    // --no-verify does NOT skip prepare-commit-msg
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(repo), /^Session:/im)
  // shape 2: the store has records, none matching (grep no-match, exit 1)
  writeRecord(store, 'rec-other', { agentPid: process.pid, harnessSessionId: 'thread-other' })
  r = commit(repo, env)
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.doesNotMatch(msg, /^Session:/im)
  assert.ok(!msg.includes('7ed51371') && !msg.includes('rec-other'))
})

test('the acting codex thread id needs no descent — it is stamped per command, and aliases to the record', (t) => {
  const { home, repo, store } = rig()
  // a codex tool shell descends from the SHARED app-server, never from the session's own agent — so descent
  // cannot be its proof; being stamped by the acting thread is.
  writeRecord(store, 'rec-codex', { harness: 'codex', harnessSessionId: 'thread-live', agentPid: stranger(t) })
  const r = commit(repo, commitEnv(home, { CODEX_THREAD_ID: 'thread-live' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.match(msg, /^Session: rec-codex$/m)                    // the RECORD id, never the raw thread id
  assert.ok(!msg.includes('thread-live'))
})

test('the acting thread outranks a leaked inherited id in the same shell', (t) => {
  const { home, repo, store } = rig()
  writeRecord(store, 'rec-acting', { harness: 'codex', harnessSessionId: 'thread-acting', agentPid: stranger(t) })
  writeRecord(store, 'rec-stale', { agentPid: stranger(t) })
  const r = commit(repo, commitEnv(home, { CODEX_THREAD_ID: 'thread-acting', SPEXCODE_SESSION_ID: 'rec-stale' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.match(msg, /^Session: rec-acting$/m)
  assert.ok(!msg.includes('rec-stale'))
})

test('identity does not depend on WHERE: the same agent is attributed outside its own worktree', () => {
  const { home, repo, store } = rig()
  // the record's worktree is elsewhere entirely (a dispatched merge runs in the main checkout, an external
  // lane in another tree) — the author is still the author.
  writeRecord(store, 'rec-merger', { agentPid: process.pid })
  const r = commit(repo, commitEnv(home, { SPEXCODE_SESSION_ID: 'rec-merger' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(repo), /^Session: rec-merger$/m)
})

test('a record whose agent is gone claims nothing', () => {
  const { home, repo, store } = rig()
  writeRecord(store, 'rec-dead', { agentPid: 2147483646 })      // a pid that cannot be alive
  const r = commit(repo, commitEnv(home, { SPEXCODE_SESSION_ID: 'rec-dead' }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(repo), /^Session:/im)
})

test('an existing Session: trailer is left alone — no restamp, no duplicate', () => {
  const { home, repo, store } = rig()
  writeRecord(store, 'rec-mine', { agentPid: process.pid })
  const r = commit(repo, commitEnv(home, { SPEXCODE_SESSION_ID: 'rec-mine' }), [], 'explicit\n\nSession: hand-set')
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.match(msg, /^Session: hand-set$/m)
  assert.equal(msg.match(/^Session:/gim)?.length, 1)
})

test('no session env at all is the plain no-op', () => {
  const { home, repo } = rig()
  const r = commit(repo, commitEnv(home))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(repo), /^Session:/im)
})
