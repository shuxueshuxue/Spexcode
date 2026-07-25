import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeHarness, codexHeadlessHarness, sessionIdentityEnvVars } from './harness.js'
import { OWNED_QUEUE_RAW_STATUS, backendLaunchAuthority, bootstrapMaterialize, canDrainQueued, composeCommandPrompt, fromRaw, launchPreflight, launchScript, markHeadlessTurnFailure, rawLifecycleStatus, resolveCommandPrompt, sessionCreateRequest, type Session, type SessRec } from './sessions.js'
import { sessionRecordPath, sessionArtifactPath, sessionStoreDir } from './layout.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('command presets compose once at the backend prompt boundary while unknown slash text passes through', () => {
  const presets = [
    { name: 'tidy', body: 'Tidy these targets:\n\n{{targets}}\n\nSee [[links]] for context.' },
    { name: 'report', body: 'Report clearly.' },
  ]
  const specs = [{ id: 'alpha', path: '.spec/project/alpha/spec.md' }]

  assert.equal(
    composeCommandPrompt('/tidy [[alpha]] keep the edge cases', presets, specs),
    'Tidy these targets:\n\n- [[alpha]] — project/alpha\n\nSee [[links]] for context.\n\nkeep the edge cases',
  )
  assert.equal(
    composeCommandPrompt('/report', presets, specs),
    'Report clearly.',
    'a targetless preset without a target placeholder stays a small prompt',
  )
  assert.match(
    composeCommandPrompt('/tidy', presets, specs),
    /No target was mentioned/,
    'plugin-body links do not become implicit invocation targets',
  )
  assert.equal(composeCommandPrompt('/missing [[alpha]]', presets, specs), '/missing [[alpha]]')
  assert.equal(composeCommandPrompt('plain prompt', presets, specs), 'plain prompt')
})

test('the live rename command resolves to the self-rename prompt through the shared resolver', async () => {
  const prompt = await resolveCommandPrompt('/rename')
  assert.match(prompt, /Review the work this session is currently doing/)
  assert.match(prompt, /spex session rename \. "<name>"/)
  assert.doesNotMatch(prompt, /No target was mentioned/)
  assert.equal(await resolveCommandPrompt('/not-a-preset'), '/not-a-preset')
})

test('session-create API rejects stale fields generically and accepts an ordinary launcher create', async () => {
  let called: [string, string | null, string | undefined] | null = null
  const created = { id: 'created-1' } as Session
  const create = async (prompt: string, parent: string | null, launcher?: string) => {
    called = [prompt, parent, launcher]
    return created
  }

  const stale = await sessionCreateRequest({ prompt: 'probe', launcher: 'claude', mode: 'headless' }, create)
  assert.deepEqual(stale, { status: 400, error: 'unknown session-create field: mode' })
  assert.equal(called, null, 'unknown fields are refused before creation')

  const removedNode = await sessionCreateRequest({ node: 'launcher-select', prompt: 'probe', launcher: 'claude' }, create)
  assert.deepEqual(removedNode, { status: 400, error: 'unknown session-create field: node' })
  assert.equal(called, null, 'the removed node field is refused before creation')

  const ordinary = await sessionCreateRequest({ prompt: '[[launcher-select]] probe', parent: null, launcher: 'claude' }, create)
  assert.deepEqual(ordinary, { status: 201, session: created })
  assert.deepEqual(called, ['[[launcher-select]] probe', null, 'claude'])
})

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

// @@@ the retry only covers what retrying can fix. Two launcher stubs, both exiting instantly: one printing
// the harness's OWN settled failure (a `--resume` id claude has no conversation for), one printing nothing a
// harness would recognise. Count the attempts each actually produces by having the stub append to a file.
test('a launch failure the harness itself called settled is attempted exactly once', () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-launch-class-'))
  process.env.SPEXCODE_HOME = home
  const run = (name: string, stubBody: string): { attempts: number; stderr: string } => {
    const counter = join(home, `${name}.attempts`)
    const stub = join(home, `${name}.sh`)
    writeFileSync(stub, `echo x >> ${JSON.stringify(counter)}\n${stubBody}\nexit 1\n`)
    const script = launchScript(`${name}-test`, '', claudeHarness, `bash ${stub}`)
    let stderr = ''
    try { execFileSync('bash', [script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch (e) { stderr = String((e as { stderr?: string | Buffer }).stderr ?? '') }
    return { attempts: readFileSync(counter, 'utf8').split('\n').filter(Boolean).length, stderr }
  }
  try {
    const settled = run('settled', 'echo "No conversation found with session ID: deadbeef" >&2')
    assert.equal(settled.attempts, 1, 'a settled failure is spent ONCE, not three times')
    assert.match(settled.stderr, /No conversation found with session ID/, "the harness's own reason stays visible on the pane")
    assert.match(settled.stderr, /retrying cannot fix \(see above\); not retrying/)
    assert.doesNotMatch(settled.stderr, /attempt 2/)

    const unclassifiable = run('unclassifiable', 'echo "the wrapper fell over" >&2')
    assert.equal(unclassifiable.attempts, 3, 'an unclassifiable fast exit keeps the bounded readiness retry')
    assert.match(unclassifiable.stderr, /fast launcher exit before readiness; retrying/)
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

// the transport's own settled failures, answered BEFORE a window is opened: a launch that cannot succeed is
// refused once with its own code, never attempted and retried on a wall clock.
test('launchPreflight refuses a launch that cannot succeed, naming which fact settled it', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-preflight-'))
  const base: SessRec = {
    session: 'preflight-test', governed: true, worktreePath: join(home, 'gone'), branch: null, node: null,
    title: null, name: null, parent: null, status: 'idle', proposal: null, merges: 0, note: null,
    sortKey: null, createdAt: 1, harness: 'claude', harnessSessionId: null, stopped: false, archived: false,
    launcher: null, launchCmd: '/bin/true', launchOwner: null,
  }
  try {
    assert.equal(launchPreflight(base)?.code, 'no-worktree', 'a worktree that is gone settles the launch')
    execFileSync('git', ['init', '-q', '-b', 'main', home])
    execFileSync('git', ['-C', home, 'config', 'user.email', 'p@e.test'])
    execFileSync('git', ['-C', home, 'config', 'user.name', 'p'])
    writeFileSync(join(home, 'f'), 'x')
    execFileSync('git', ['-C', home, 'add', '-A'])
    execFileSync('git', ['-C', home, 'commit', '-qm', 'seed'])
    const live = { ...base, worktreePath: home }
    assert.equal(launchPreflight(live), null, 'a live worktree with no branch pinned passes')
    assert.equal(launchPreflight({ ...live, branch: 'node/never-existed' })?.code, 'no-branch')
    assert.equal(launchPreflight({ ...live, branch: 'main' }), null, 'an existing branch passes')
    assert.equal(launchPreflight({ ...live, launchCmd: '/nope/not-here --flag' })?.code, 'no-launcher')
    assert.equal(launchPreflight({ ...live, launchCmd: 'bare-name-on-path' }), null, 'a bare name is left to PATH, never guessed at')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('one-shot headless launch does not retry a successful fast exit', () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-one-shot-launch-'))
  process.env.SPEXCODE_HOME = home
  try {
    const script = launchScript('one-shot-launch-test', '', codexHeadlessHarness, 'true')
    const body = readFileSync(script, 'utf8')
    assert.doesNotMatch(body, /for __spex_try in 1 2 3/)
    assert.doesNotMatch(body, /fast launcher exit before readiness/)
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
      harness: 'claude', harnessSessionId: null, stopped: false, archived: false,
      launcher: 'reclaude', launchCmd: 'claude', launchOwner: null,
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

test('headless turn failure is an active-only error projection', () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-headless-turn-state-'))
  process.env.SPEXCODE_HOME = home
  const id = `headless-turn-state-${process.pid}`
  // a REAL worktree dir: a record naming a directory that does not exist is a retired session, which no
  // lifecycle writer may touch — this test is about the turn-failure CAS on a LIVE one.
  const worktree = join(home, 'headless-turn-state')
  const raw = {
    session_id: id, governed: true, worktree_path: worktree, branch: 'node/headless-turn-state',
    node: 'harness-adapter', title: null, name: null, parent: null, status: 'active', proposal: null,
    merges: 0, note: null, sortkey: null, createdAt: 1, harness: 'opencode-headless',
    harness_session_id: null, launcher: 'turn-dead', launch_cmd: '/bin/false', launch_owner: null,
  }
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    mkdirSync(worktree, { recursive: true })
    writeFileSync(sessionRecordPath(id), JSON.stringify(raw, null, 2) + '\n')
    assert.equal(markHeadlessTurnFailure(id, 'opencode-headless', '1'), true)
    let stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'error')
    assert.equal(stored.note, 'opencode-headless turn exited with exit code 1')

    stored.status = 'awaiting'
    stored.proposal = 'nothing'
    writeFileSync(sessionRecordPath(id), JSON.stringify(stored, null, 2) + '\n')
    assert.equal(markHeadlessTurnFailure(id, 'opencode-headless', '7'), false, 'a declaration wins over a late child close')
    stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'awaiting')
    assert.equal(stored.note, 'opencode-headless turn exited with exit code 1')

    stored.status = 'active'
    writeFileSync(sessionRecordPath(id), JSON.stringify(stored, null, 2) + '\n')
    assert.equal(markHeadlessTurnFailure(id, 'opencode-headless', '0'), false, 'zero exit never manufactures an error')
    stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'active')
    assert.equal(stored.note, 'opencode-headless turn exited with exit code 1')
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('owned queues are public-authority leased and raw-state fenced from legacy drainers', () => {
  const publicAuthority = backendLaunchAuthority({
    SPEXCODE_API_URL: 'https://operator:secret@127.0.0.1:8787/api/?token=private#fragment',
    PORT: '44725',
  })
  assert.equal(publicAuthority, 'https://127.0.0.1:8787/api')
  assert.doesNotMatch(publicAuthority, /operator|secret|token|44725/)

  const base: SessRec = {
    session: 'owned-q', governed: true, worktreePath: '/wt/q', branch: 'node/q', node: null, title: null,
    name: null, parent: null, status: 'queued', proposal: null, merges: 0, note: null, sortKey: null,
    createdAt: 1, harness: 'codex', harnessSessionId: null, stopped: false, archived: false, launcher: 'codex', launchCmd: 'codex',
    launchOwner: publicAuthority,
  }
  assert.equal(rawLifecycleStatus(base), OWNED_QUEUE_RAW_STATUS)
  assert.notEqual(rawLifecycleStatus(base), 'queued', 'a legacy status === queued selector cannot claim it')

  const reread = fromRaw({
    session_id: base.session, governed: true, worktree_path: base.worktreePath, branch: base.branch, node: null,
    title: null, name: null, status: OWNED_QUEUE_RAW_STATUS, proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: 1, harness: 'codex', launcher: 'codex', launch_cmd: 'codex',
    launch_owner: publicAuthority,
  })
  assert.equal(reread.status, 'queued', 'the current public record still reports queued before launch')
  assert.equal(reread.stopped, false, 'records from before stop tracking default to not stopped')
  assert.equal(canDrainQueued(reread, publicAuthority), true, 'a replacement child at the same public authority takes over')
  assert.equal(canDrainQueued(reread, 'http://127.0.0.1:8956'), false, 'a different backend authority cannot claim it')
  assert.equal(canDrainQueued({ status: 'queued', launchOwner: null }, 'http://127.0.0.1:8956'), true, 'legacy unowned queues remain adoptable')
})

test('a launch establishes identity: inherited session ids are stripped, this session\'s is set', () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-identity-'))
  process.env.SPEXCODE_HOME = home
  try {
    const script = readFileSync(launchScript('identity-launch-test', "'hi'", claudeHarness, 'true'), 'utf8')
    // the pane inherits the tmux SERVER's env, so whatever session started that server would otherwise ride
    // along into every worker — the leak class behind github#76. The launch strips them all, then sets its own.
    for (const v of sessionIdentityEnvVars()) assert.match(script, new RegExp(`env[^\\n]*-u ${v}\\b`), v)
    assert.match(script, /SPEXCODE_SESSION_ID=identity-launch-test/)
    assert.ok(sessionIdentityEnvVars().includes('SPEXCODE_SESSION_ID'))
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME; else process.env.SPEXCODE_HOME = prevHome
  }
})
