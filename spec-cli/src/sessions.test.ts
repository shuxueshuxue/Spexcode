import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeHarness } from './harness.js'
import { bootstrapMaterialize, launchScript, type SessRec } from './sessions.js'
import { sessionRecordPath } from './layout.js'

test('launch retry log names the fast exit without guessing a daemon race', () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-launch-log-'))
  process.env.SPEXCODE_HOME = home
  try {
    const script = launchScript('retry-log-test', '', claudeHarness, 'false')
    let stderr = ''
    try {
      execFileSync('bash', [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      stderr = String((e as { stderr?: string | Buffer }).stderr ?? '')
    }

    assert.match(stderr, /\[spex launch\] attempt 1 exited in \d+s \(rc=1\) - fast launcher exit before readiness; retrying/)
    assert.doesNotMatch(stderr, /likely a launcher daemon race|daemon-not-ready race/i)
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('a failed creation-time materialize is reported loud and stamped on the record note', () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-materialize-fail-'))
  process.env.SPEXCODE_HOME = home
  const errors: string[] = []
  const prevError = console.error
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
  try {
    const rec: SessRec = {
      session: 'mat-fail-test', governed: true, worktreePath: '/tmp/spex-mat-fail-worktree', branch: 'node/mat-fail',
      node: null, title: 'mat fail', name: null, parent: null,
      status: 'queued', proposal: null, merges: 0, note: null, sortKey: null, createdAt: 1,
      harness: 'claude', harnessSessionId: null, launcher: 'reclaude', launchCmd: 'claude',
    }
    bootstrapMaterialize(rec, () => { throw new Error('render exploded') })

    const logged = errors.join('\n')
    assert.match(logged, /materialize failed/)
    assert.match(logged, /\/tmp\/spex-mat-fail-worktree/)
    assert.match(logged, /render exploded/)
    assert.match(logged, /UNGOVERNED/)
    const stored = readFileSync(sessionRecordPath('mat-fail-test'), 'utf8')
    assert.match(stored, /"note": "materialize failed at creation — worker ungoverned \(no hooks\/contract\): render exploded"/)
  } finally {
    console.error = prevError
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})
