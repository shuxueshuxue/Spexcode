import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

// The session-stamp hook (templates/hooks/prepare-commit-msg) runs on EVERY commit in EVERY repo it is
// installed in, under whatever env the shell happens to carry — and that env LIES. Codex's per-project
// app-server is shared by every worktree's thread but is started by whichever session launched first, so its
// baked SPEXCODE_SESSION_ID (and any inherited harness var) names a stranger for everyone else, and names
// nobody at all once that session closes and its record is swept (github#76: 48 commits in the SpexCode repo
// stamped with one such ghost). So attribution comes from the TREE — the record whose `worktree_path` IS the
// tree being committed in — which the hook can verify. These tests drive the REAL template through real
// `git commit`s in real linked worktrees.

const HOOK_TEMPLATE = fileURLToPath(new URL('../templates/hooks/prepare-commit-msg', import.meta.url))

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
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'seed', '--no-verify'], { env: bareEnv() })
  return dir
}

// a REAL linked worktree of that repo — what the backend creates for a session (and what a human creates by
// hand for an integration branch; the two are indistinguishable to git, and that is the point).
function worktree(repo: string, name: string): string {
  const path = join(repo, '..', `${name}-${Math.random().toString(36).slice(2, 8)}`)
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', name, path])
  return execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

// the hook's own store derivation: <SPEXCODE_HOME>/projects/<dirname(abs git-common-dir), [/.] → ->. A linked
// worktree shares its main checkout's git-common-dir, so both resolve to ONE project store.
function projectStore(home: string, repo: string): string {
  const gcd = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return join(home, 'projects', dirname(gcd).replace(/[/.]/g, '-'))
}

function writeRecord(store: string, recordId: string, worktreePath: string, harness = 'codex'): void {
  const dir = join(store, 'sessions', recordId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: recordId, governed: true, worktree_path: worktreePath, branch: null,
    status: 'active', harness, harness_session_id: `${recordId}-thread`,
  }, null, 2))
}

// child env: strip the session vars this test process itself may have inherited (a claude- or codex-launched
// runner), then overlay the case's own.
function bareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CODEX_THREAD_ID
  delete env.SPEXCODE_SESSION_ID
  delete env.SPEXCODE_HOME
  return env
}
function commitEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...bareEnv(), SPEXCODE_HOME: home, ...extra }
}

let n = 0
function commit(tree: string, env: NodeJS.ProcessEnv, args: string[] = [], message = `c${++n}`) {
  writeFileSync(join(tree, 'f.txt'), `content ${n} ${Math.random()}`)
  execFileSync('git', ['-C', tree, 'add', 'f.txt'])
  return spawnSync('git', ['-C', tree, 'commit', ...args, '-m', message], { env, encoding: 'utf8' })
}

function lastMessage(tree: string): string {
  return execFileSync('git', ['-C', tree, 'log', '-1', '--format=%B'], { encoding: 'utf8' })
}

function rig(): { home: string; repo: string; store: string } {
  const home = mkdtempSync(join(tmpdir(), 'spexhome-'))
  const repo = gitRepo()
  return { home, repo, store: projectStore(home, repo) }
}

test('the session that OWNS the tree is stamped — with no session env at all', () => {
  const { home, repo, store } = rig()
  const tree = worktree(repo, 'node-work')
  writeRecord(store, 'rec-owner', tree)
  const r = commit(tree, commitEnv(home))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(tree), /^Session: rec-owner$/m)   // attribution needs no environment channel
})

test('a stale session id in the environment never outvotes the tree\'s owner', () => {
  const { home, repo, store } = rig()
  const mine = worktree(repo, 'node-mine')
  const theirs = worktree(repo, 'node-theirs')
  writeRecord(store, 'rec-mine', mine)
  writeRecord(store, 'rec-theirs', theirs, 'claude')
  // every shape of the lie at once: the shared app-server's baked record id, a foreign thread id, and a
  // claude id that names no record whatsoever (a closed session's, already swept)
  const r = commit(mine, commitEnv(home, {
    SPEXCODE_SESSION_ID: 'rec-theirs',
    CODEX_THREAD_ID: 'rec-theirs-thread',
    CLAUDE_CODE_SESSION_ID: '7ed51371-cece-4f27-9891-0e1c330c587c',
  }))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(mine)
  assert.match(msg, /^Session: rec-mine$/m)
  assert.ok(!msg.includes('rec-theirs'))                     // never a stranger's session
  assert.ok(!msg.includes('7ed51371'))                       // never an id that names no record
})

test('a tree no session owns gets NO trailer — the main checkout, a hand-made worktree, a foreign env', () => {
  const { home, repo, store } = rig()
  const manual = worktree(repo, 'integration')                // hand-made: `git worktree add`, no record
  const env = commitEnv(home, {
    SPEXCODE_SESSION_ID: 'rec-elsewhere',
    CODEX_THREAD_ID: 'rec-elsewhere-thread',
    CLAUDE_CODE_SESSION_ID: 'ghost-with-no-record',
  })

  // shape 1: the store has no sessions dir at all (the glob never expands)
  let r = commit(manual, env, ['--no-verify'])                // --no-verify does NOT skip prepare-commit-msg
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(manual), /^Session:/im)

  // shape 2: the store HAS a record, owning a DIFFERENT tree — the github#76 shape
  writeRecord(store, 'rec-elsewhere', worktree(repo, 'node-other'), 'claude')
  for (const tree of [manual, repo]) {                        // hand-made worktree, then the main checkout
    r = commit(tree, env)
    assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
    const msg = lastMessage(tree)
    assert.doesNotMatch(msg, /^Session:/im)                   // no empty trailer,
    assert.ok(!msg.includes('rec-elsewhere'))                 // no stranger,
    assert.ok(!msg.includes('ghost-with-no-record'))          // no ghost
  }
})

test('a record whose worktree is gone matches nothing and breaks nothing', () => {
  const { home, repo, store } = rig()
  const tree = worktree(repo, 'node-live')
  writeRecord(store, 'rec-dead', join(repo, '..', 'removed-worktree'))   // path does not exist
  writeRecord(store, 'rec-live', tree)
  const r = commit(tree, commitEnv(home))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(tree), /^Session: rec-live$/m)
})

test('one tree spelled two ways is one tree — the owner is matched by identity, not by string', () => {
  const { home, repo, store } = rig()
  const tree = worktree(repo, 'node-symlinked')
  const alias = join(mkdtempSync(join(tmpdir(), 'spex-alias-')), 'link')
  symlinkSync(tree, alias)
  writeRecord(store, 'rec-owner', alias)                     // the record's spelling goes through a symlink
  const r = commit(tree, commitEnv(home))                    // git reports the resolved one
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(tree), /^Session: rec-owner$/m)
  rmSync(dirname(alias), { recursive: true, force: true })
})

test('an existing Session: trailer is left alone — no restamp, no duplicate', () => {
  const { home, repo, store } = rig()
  const tree = worktree(repo, 'node-explicit')
  writeRecord(store, 'rec-owner', tree)
  const r = commit(tree, commitEnv(home), [], 'explicit\n\nSession: hand-set')
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(tree)
  assert.match(msg, /^Session: hand-set$/m)
  assert.equal(msg.match(/^Session:/gim)?.length, 1)
})

test('a repo with no SpexCode store at all commits cleanly', () => {
  const { home, repo } = rig()
  const r = commit(repo, commitEnv(home))
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.doesNotMatch(lastMessage(repo), /^Session:/im)
})
