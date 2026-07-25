import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

// The session-stamp hook (templates/hooks/prepare-commit-msg) writes the `Session:` trailer from
// SPEXCODE_SESSION_ID and nothing else. That variable is not "whatever the shell happens to carry": a session
// launch bakes it in after stripping every inherited identity, a codex thread has it injected per thread at
// thread/start, and processes belonging to no single session (the shared app-server) are spawned without it —
// so being present already means belonging. github#76 was that invariant missing, not this read being naive:
// a daemon outlived its session and handed its id to strangers' commits.
// These tests drive the REAL template through real `git commit`s.

const HOOK_TEMPLATE = fileURLToPath(new URL('../templates/hooks/prepare-commit-msg', import.meta.url))

function bareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const v of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[v]
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

let n = 0
function commit(repo: string, extra: Record<string, string>, args: string[] = [], message = `c${++n}`) {
  writeFileSync(join(repo, 'f.txt'), `content ${n} ${Math.random()}`)
  execFileSync('git', ['-C', repo, 'add', 'f.txt'])
  return spawnSync('git', ['-C', repo, 'commit', ...args, '-m', message], { env: { ...bareEnv(), ...extra }, encoding: 'utf8' })
}

const lastMessage = (repo: string) => execFileSync('git', ['-C', repo, 'log', '-1', '--format=%B'], { encoding: 'utf8' })

test('the session id the launch injected becomes the trailer, verbatim', () => {
  const repo = gitRepo()
  const r = commit(repo, { SPEXCODE_SESSION_ID: 'rec-mine' })
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  assert.match(lastMessage(repo), /^Session: rec-mine$/m)
})

test('no session id, no trailer — and the commit still succeeds', () => {
  const repo = gitRepo()
  // --no-verify does NOT skip prepare-commit-msg, and the hook runs under `set -euo pipefail`: a missing id
  // must be a clean no-op, never an abort that takes the commit with it.
  for (const args of [[], ['--no-verify']]) {
    const r = commit(repo, {}, args)
    assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
    assert.doesNotMatch(lastMessage(repo), /^Session:/im)
  }
})

test('a harness\'s own conversation id is not an attribution channel', () => {
  const repo = gitRepo()
  // CODEX_THREAD_ID / CLAUDE_CODE_SESSION_ID are the harness's bookkeeping for its own conversation, not the
  // governed record id — a thread id in a commit message links to nothing. Every governed context carries
  // SPEXCODE_SESSION_ID; a context that does not is not a governed session.
  for (const extra of [{ CODEX_THREAD_ID: '019f97c0-a5ef-70d2-9c21-df2161e3005c' }, { CLAUDE_CODE_SESSION_ID: 'some-claude-conversation' }] as Record<string, string>[]) {
    const r = commit(repo, extra)
    assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
    const msg = lastMessage(repo)
    assert.doesNotMatch(msg, /^Session:/im)
    assert.ok(!msg.includes('019f97c0') && !msg.includes('some-claude-conversation'))
  }
})

test('an existing Session: trailer is left alone — no restamp, no duplicate', () => {
  const repo = gitRepo()
  const r = commit(repo, { SPEXCODE_SESSION_ID: 'rec-mine' }, [], 'explicit\n\nSession: hand-set')
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const msg = lastMessage(repo)
  assert.match(msg, /^Session: hand-set$/m)
  assert.equal(msg.match(/^Session:/gim)?.length, 1)
})

test('the trailer joins an existing trailer block instead of opening a new paragraph', () => {
  const repo = gitRepo()
  // git parses ONLY the last paragraph as trailers, so an appended paragraph would demote `spex ack`'s
  // Spec-OK to body prose.
  const r = commit(repo, { SPEXCODE_SESSION_ID: 'rec-mine' }, [], 'ack: Spec-OK sessions\n\nSpec-OK: sessions')
  assert.equal(r.status, 0, `commit failed: ${r.stderr}${r.stdout}`)
  const trailers = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%(trailers:only,valueonly)'], { encoding: 'utf8' })
  assert.match(trailers, /sessions/)
  assert.match(trailers, /rec-mine/)
})
