import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeHarness } from './harness.js'
import { bootstrapMaterialize, fromRaw, launchScript, type SessRec } from './sessions.js'
import { sessionRecordPath, sessionArtifactPath, type RawRecord } from './layout.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// @@@ birth registration — EXECUTE a generated launch.sh whose agent command is a stub, and prove the wrapper
// writes the REAL agent pid to agent.pid before exec (the anchor of the 100ms hot death tier), AND that an
// argument carrying spaces/quotes/`$` survives the extra `sh -c` nesting un-double-expanded ([[state]]).
test('launchScript registers the agent pid before exec and preserves tricky quoted args', async () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-birth-'))
  process.env.SPEXCODE_HOME = home
  const id = `birth-pid-test-${process.pid}`
  const argsFile = join(home, 'stub-args.txt')
  const stub = join(home, 'stub.sh')
  // the stub records its $1 verbatim, then EXECs sleep — so the final process is `sleep`, sharing the pid the
  // wrapper's `$$` registered. A value with a single quote, a double quote, spaces AND a literal `$` proves
  // nothing double-expands through sh -c → env → bash(stub) → exec.
  const argVal = `arg with 'quotes' and "dq" and $pace`
  writeFileSync(stub, `printf '%s' "$1" > ${JSON.stringify(argsFile)}\nexec sleep 5\n`)
  const tail = `'${argVal.replace(/'/g, `'\\''`)}'`
  const script = launchScript(id, tail, claudeHarness, `bash ${stub}`)

  let child: ReturnType<typeof spawn> | null = null
  const pidPath = sessionArtifactPath(id, 'agent.pid')
  try {
    child = spawn('bash', [script], { detached: true, stdio: 'ignore' })
    // wait for the wrapper to write agent.pid and for the stub to record its arg + exec sleep.
    const deadline = Date.now() + 4000
    while ((!existsSync(pidPath) || !existsSync(argsFile)) && Date.now() < deadline) await sleep(50)
    assert.ok(existsSync(pidPath), 'agent.pid was written before exec')
    const agentPid = Number(readFileSync(pidPath, 'utf8').trim())
    assert.ok(Number.isInteger(agentPid) && agentPid > 0, `agent.pid holds a real pid (got ${agentPid})`)

    // that pid is ALIVE and IS the exec'd `sleep` (the wrapper's $$ persisted down the whole chain).
    assert.doesNotThrow(() => process.kill(agentPid, 0), 'the registered pid is a live process')
    const comm = spawnSync('ps', ['-o', 'args=', '-p', String(agentPid)], { encoding: 'utf8' }).stdout || ''
    assert.match(comm, /sleep/, `the registered pid is the exec'd agent (sleep), got: ${comm.trim()}`)

    // the tricky argument reached the stub as ONE arg, byte-for-byte — no expansion of the quotes or `$`.
    assert.equal(readFileSync(argsFile, 'utf8'), argVal)
  } finally {
    try { if (existsSync(pidPath)) process.kill(Number(readFileSync(pidPath, 'utf8').trim())) } catch { /* already gone */ }
    try { if (child?.pid) process.kill(-child.pid) } catch { /* group already reaped */ }
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

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
      harness: 'claude', harnessSessionId: null, launcher: 'reclaude', launchCmd: 'claude', mode: 'interactive',
    }
    bootstrapMaterialize(rec, () => { throw new Error('materialize exploded') })

    const logged = errors.join('\n')
    assert.match(logged, /materialize failed/)
    assert.match(logged, /\/tmp\/spex-mat-fail-worktree/)
    assert.match(logged, /materialize exploded/)
    assert.match(logged, /UNGOVERNED/)
    const stored = readFileSync(sessionRecordPath('mat-fail-test'), 'utf8')
    assert.match(stored, /"note": "materialize failed at creation — worker ungoverned \(no hooks\/contract\): materialize exploded"/)
  } finally {
    console.error = prevError
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

// [[launcher-select]] headless — the OLD-RECORD fallback: `mode` follows the same read rule as
// `harness || 'claude'`. A record written before modes (no field), or carrying junk, reads `interactive`,
// so every pre-existing session keeps its exact behavior; only an explicit 'headless' reads headless.
test('old records without a mode field read interactive; only an explicit headless reads headless', () => {
  const raw = (over: Partial<RawRecord> = {}): RawRecord => ({
    session_id: 's1', governed: true, worktree_path: '/wt/x', branch: 'node/x-1', node: 'x',
    title: null, name: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: 1,
    ...over,
  })
  assert.equal(fromRaw(raw()).mode, 'interactive')                          // pre-mode record → interactive, unchanged paths
  assert.equal(fromRaw(raw({ mode: '' })).mode, 'interactive')              // empty value → interactive
  assert.equal(fromRaw(raw({ mode: 'garbage' })).mode, 'interactive')       // junk never becomes a mode
  assert.equal(fromRaw(raw({ mode: 'headless' })).mode, 'headless')         // the one explicit opt-in
})
