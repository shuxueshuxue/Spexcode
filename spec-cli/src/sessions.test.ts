import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeHarness, codexHarness, codexHeadlessHarness, sessionIdentityEnvVars, stampRvSock, type SharedRuntimeProbe } from './harness.js'
import { processStartToken } from '@spexcode/spec-core'
import { jsonMigrationFencePath } from '@spexcode/session-application'
import { spawnDetachedRuntime } from './runtime-ownership.js'
import { OWNED_QUEUE_RAW_STATUS, backendLaunchAuthority, bootstrapMaterialize, canDrainQueued, closeSession, commitUrlForRemote, composeCommandPrompt, drainQueue, drainSession, existingHarnessLaunchTarget, fromRaw, turnFailureNote, turnFailureRetryDelay, installSessionLeafProcessProbeForTest, launchPreflight, launchScript, launchShellCommand, listSessions, markHarnessSessionId, markTurnFailure, markHeadlessTurnFailure, parseSessionLeafReceipt, rawLifecycleStatus, resolveCommandPrompt, resumeSession, sendText, sessionCreateRequest, sessionHasPendingDelivery, sessionLeafReceiptCandidate, sessionLeafReceiptIdentityState, spawnerClause, stageHarnessLaunchProof, stopSession, type Session, type SessRec } from './sessions.js'
import { gitCommonDir, mainRoot, runtimeRoot, sessionRecordPath, sessionArtifactPath, sessionStoreDir } from '@spexcode/spec-core'
import { readTimeline } from './session-timeline.js'
import { readCodexGenerationLedger } from './codex-runtime-generations.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// This file mutates process-global harness and runtime state, so its fixtures must not overlap.
const serial = { concurrency: false } as const
const thisTestFile = fileURLToPath(import.meta.url)
const packageRoot = dirname(dirname(thisTestFile))
const waitUntil = async (check: () => boolean, label: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(20)
  }
}

test('canonical delivery retry reads the SQLite queue instead of legacy pending.json', () => {
  const pending = { protocol: { listPending: () => [{ messageId: 'sqlite-message' }] } } as any
  const empty = { protocol: { listPending: () => [] } } as any
  assert.equal(sessionHasPendingDelivery('canonical-pending', pending), true)
  assert.equal(sessionHasPendingDelivery('canonical-empty', empty), false)
})

test('session diff commit links preserve the full forge repository and commit identity', () => {
  const commit = '2dcade6662e89689444e3ee1cc73a866dcab83d0'
  assert.equal(commitUrlForRemote('git@github.com:shuxueshuxue/spexcode.git', commit),
    `https://github.com/shuxueshuxue/spexcode/commit/${commit}`)
  assert.equal(commitUrlForRemote('ssh://git@gitlab.example.com/group/project.git', commit),
    `https://gitlab.example.com/group/project/-/commit/${commit}`)
  assert.equal(commitUrlForRemote('/local/repository', commit), null)
})

test('session leaf receipt is strict and only exact stable pane ancestry can mint it', () => {
  const procs = new Map([
    [10, { ppid: 1, comm: 'bash' }],
    [20, { ppid: 10, comm: 'launch.sh' }],
    [30, { ppid: 20, comm: 'pi' }],
    [40, { ppid: 1, comm: 'unrelated' }],
  ])
  const minted = sessionLeafReceiptCandidate('session-a', 30, 10, procs, 'start-a', 'start-a')
  assert.equal(minted.ok, true)
  if (!minted.ok) return
  assert.deepEqual(minted.receipt, {
    version: 1, kind: 'session-leaf', sessionId: 'session-a', pid: 30, startToken: 'start-a',
  })
  assert.match(sessionLeafReceiptCandidate('session-a', 40, 10, procs, 'start-u', 'start-u').reason ?? '', /not in.*pane/u)
  assert.match(sessionLeafReceiptCandidate('session-a', 30, null, procs, 'start-a', 'start-a').reason ?? '', /pane/u)
  assert.match(sessionLeafReceiptCandidate('session-a', 30, 10, null, 'start-a', 'start-a').reason ?? '', /process snapshot/u)
  assert.match(sessionLeafReceiptCandidate('session-a', 30, 10, procs, 'start-a', 'start-b').reason ?? '', /changed/u)

  const encoded = JSON.stringify(minted.receipt)
  assert.deepEqual(parseSessionLeafReceipt(encoded, 'session-a'), minted.receipt)
  assert.equal(parseSessionLeafReceipt(encoded, 'session-b'), null, 'a receipt cannot cross session ownership')
  assert.equal(parseSessionLeafReceipt('{', 'session-a'), null)
  assert.equal(parseSessionLeafReceipt(JSON.stringify({ ...minted.receipt, extra: true }), 'session-a'), null, 'strict shape rejects extra authority fields')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, 30, 'start-a', 'alive'), 'same-live')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, 30, null, 'dead'), 'gone', 'ESRCH is the death witness')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, 30, null, 'alive'), 'unknown', 'a live PID with unreadable start identity stays fail-closed')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, 30, null, 'unknown'), 'unknown', 'an inconclusive kill-0 stays fail-closed')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, 30, 'reused-start', 'alive'), 'pid-reused')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, 31, 'other-start', 'alive'), 'registration-changed')
  assert.equal(sessionLeafReceiptIdentityState(minted.receipt, null, null, 'dead'), 'registration-missing')
})

const LIVE_PROJECT_SESSIONS = '/home/jeffry/.spexcode/projects/-home-jeffry-spexcode/sessions'
type LiveSessionsCensus = { ids: string[]; count: number; hash: string }
function liveSessionsCensus(): LiveSessionsCensus {
  const ids = existsSync(LIVE_PROJECT_SESSIONS)
    ? readdirSync(LIVE_PROJECT_SESSIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : []
  return { ids, count: ids.length, hash: createHash('sha256').update(ids.join('\0')).digest('hex') }
}
function assertLiveSessionsUnchanged(before: LiveSessionsCensus, label: string): void {
  assert.deepEqual(liveSessionsCensus(), before,
    `${label} must not create, remove, or retarget any id in ${LIVE_PROJECT_SESSIONS}`)
}
function assertIsolatedResumeStore(home: string, id: string): void {
  assert.ok(sessionStoreDir(id).startsWith(`${home}/`), `resume fixture ${id} store escaped isolated SPEXCODE_HOME`)
  assert.ok(runtimeRoot().startsWith(`${home}/`), `resume fixture ${id} runtime root escaped isolated SPEXCODE_HOME`)
}

test('command presets compose once at the backend prompt boundary while unknown slash text passes through', serial, () => {
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

test('the live rename command resolves to the self-rename prompt through the shared resolver', serial, async () => {
  const prompt = await resolveCommandPrompt('/rename')
  assert.match(prompt, /Review the work this session is currently doing/)
  assert.match(prompt, /spex session rename \. "<name>"/)
  assert.doesNotMatch(prompt, /No target was mentioned/)
  assert.equal(await resolveCommandPrompt('/not-a-preset'), '/not-a-preset')
})

test('Codex registration does not persist an unbound thread when exact generation binding fails', serial, () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousGeneration = process.env.SPEXCODE_CODEX_GENERATION
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-registration-'))
  const id = `codex-registration-${process.pid}`
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_GENERATION = 'missing-generation'
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: worktree, branch: 'main', node: '', title: '', name: '', parent: '',
      status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: '',
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
    }, null, 2)}\n`)
    const before = readFileSync(sessionRecordPath(id), 'utf8')
    const root = runtimeRoot()
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'codex-app-server-generations.json'), '{"version":3,"revision":1,"current":null,"pending":null,"generations":{},"bindings":{}}\n')
    writeFileSync(sessionArtifactPath(id, 'launch'), 'resolved task')
    assert.throws(() => stageHarnessLaunchProof(id, 'native-thread', 'resolved task'), /absent or reclaimed/)
    assert.equal(readFileSync(sessionRecordPath(id), 'utf8'), before)
    assert.equal(readCodexGenerationLedger(root).bindings[id], undefined)
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousGeneration === undefined) delete process.env.SPEXCODE_CODEX_GENERATION
    else process.env.SPEXCODE_CODEX_GENERATION = previousGeneration
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex launch retry reuses a staged native target after the first payload is consumed', serial, () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousGeneration = process.env.SPEXCODE_CODEX_GENERATION
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-retry-target-'))
  const id = `codex-retry-target-${process.pid}`
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const payload = 'authoritative first turn'
  process.env.SPEXCODE_HOME = home
  delete process.env.SPEXCODE_CODEX_GENERATION
  try {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: worktree, branch: 'main', node: '', title: '', name: '', parent: '',
      status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex',
      harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex',
      launch_cmd: 'codex', launch_owner: '', create_request_id: '', create_payload_hash: '', launch_readiness_pending: '',
    }, null, 2)}\n`)
    writeFileSync(sessionArtifactPath(id, 'launch'), payload)
    assert.equal(stageHarnessLaunchProof(id, 'thread-retry', payload), true)
    assert.equal(existingHarnessLaunchTarget(id), 'thread-retry', 'a retry can use the staged receipt before its record commit')

    // This is the exact failure window from the report: the lifecycle owner consumed `launch`, but the retry
    // entered codex-launch before (or while) it bound the staged receipt.
    rmSync(sessionArtifactPath(id, 'launch'))
    assert.equal(existingHarnessLaunchTarget(id), 'thread-retry', 'a consumed payload still leaves the staged receipt reusable')

    const currentReceipt = sessionArtifactPath(id, 'launch.receipt')
    const legacyReceipt = sessionArtifactPath(id, 'launch.proof')
    copyFileSync(currentReceipt, legacyReceipt)
    rmSync(currentReceipt)
    assert.equal(existingHarnessLaunchTarget(id), 'thread-retry', 'a one-release legacy receipt remains reusable after upgrade')
    assert.equal(existsSync(currentReceipt), false, 'compatibility reads the legacy receipt instead of writing a second artifact')

    const record = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    record.harness_session_id = 'thread-retry'
    writeFileSync(sessionRecordPath(id), `${JSON.stringify(record, null, 2)}\n`)
    rmSync(legacyReceipt)
    assert.equal(existingHarnessLaunchTarget(id), 'thread-retry', 'after receipt consumption the durable identity remains authoritative')
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousGeneration === undefined) delete process.env.SPEXCODE_CODEX_GENERATION
    else process.env.SPEXCODE_CODEX_GENERATION = previousGeneration
    rmSync(home, { recursive: true, force: true })
  }
})

test('session-create API rejects stale fields before entering the transaction', serial, async () => {
  const stale = await sessionCreateRequest({ prompt: 'probe', launcher: 'claude', mode: 'headless' })
  assert.deepEqual(stale, { status: 400, error: 'unknown session-create field: mode' })

  const removedNode = await sessionCreateRequest({ node: 'launcher-select', prompt: 'probe', launcher: 'claude' })
  assert.deepEqual(removedNode, { status: 400, error: 'unknown session-create field: node' })
})

test('session-create API refuses the retired JSON store while migration is fenced', serial, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-json-migration-fence-'))
  process.env.SPEXCODE_HOME = home
  try {
    const fence = jsonMigrationFencePath(join(runtimeRoot(), 'sessions'))
    mkdirSync(dirname(fence), { recursive: true })
    mkdirSync(join(dirname(fence), 'existing-session'), { recursive: true })
    writeFileSync(fence, '{"version":1,"state":"migrating"}\n', { flag: 'wx' })
    const result = await sessionCreateRequest({ prompt: 'must not enter retired JSON store' })
    assert.equal(result.status, 409)
    assert.match(result.error, /legacy JSON session store is fenced/)
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('session creation exports only the bounded transaction owner', serial, async () => {
  const surface = await import('./sessions.js') as Record<string, unknown>
  assert.equal(surface.newSession, undefined)
  assert.equal(typeof surface.sessionCreateRequest, 'function')
})

// @@@ birth registration — EXECUTE a generated launch.sh whose agent command is a stub, and prove the wrapper
// writes the REAL agent pid to agent.pid before exec (the anchor of the 100ms hot death tier), AND that an
// argument carrying spaces/quotes/`$` survives the extra `sh -c` nesting un-double-expanded ([[state]]).
test('launchScript registers the agent pid before exec and preserves tricky quoted args', serial, async () => {
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
  const receiptPath = sessionArtifactPath(id, 'agent.identity.json')
  const launchBody = readFileSync(script, 'utf8')
  assert.ok(launchBody.indexOf(receiptPath) >= 0 && launchBody.indexOf(receiptPath) < launchBody.indexOf(pidPath),
    'every launch attempt retires the old receipt before registering its replacement PID')
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

test('launch transport keeps a launch.sh path with spaces and quotes as one shell argument', serial, () => {
  const previousHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-launch-home-'))
  const spaced = mkdtempSync(join(tmpdir(), "spex launch 'path'-"))
  process.env.SPEXCODE_HOME = home
  const oneShotHarness = { ...claudeHarness, launchOneShot: true, launchCmd: () => 'true' }
  try {
    const generated = launchScript('shell-path-test', '', oneShotHarness, 'true')
    const copied = join(spaced, 'launch.sh')
    copyFileSync(generated, copied)
    const command = launchShellCommand(copied)
    assert.match(command, /^bash '/, 'the path is quoted for the shell')
    assert.equal(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }), '')
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
    rmSync(spaced, { recursive: true, force: true })
  }
})

function writeResumeFixtureRecord(id: string, worktree: string, launchCmd: string): void {
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch: 'main',
    node: 'sessions-core', title: '', name: '', parent: '', status: 'active', proposal: '',
    merges: 0, note: 'preserve-before-readiness', sortkey: '', createdAt: Date.now(), harness: 'codex-headless',
    harness_session_id: `thread-${id}`, stopped: true, archived: false, cold_proof: '', adapter_recovery: '',
    launcher: 'fixture', launch_cmd: launchCmd, launch_owner: '', create_request_id: '', create_payload_hash: '',
    launch_readiness_pending: '',
  }, null, 2)}\n`)
}

function writeResumeTmuxFixture(bin: string, commandPath: string, launchPidPath: string): void {
  mkdirSync(bin, { recursive: true })
  const tmux = join(bin, 'tmux')
  writeFileSync(tmux, `#!/usr/bin/env bash
set -eu
args=" $* "
if [[ "$args" == *" list-sessions "* ]] || [[ "$args" == *" list-panes "* ]]; then exit 0; fi
if [[ "$args" == *" send-keys "* && "$args" == *" -l "* ]]; then printf '%s' "\${!#}" > ${JSON.stringify(commandPath)}; exit 0; fi
if [[ "$args" == *" send-keys "* && "\${!#}" == "Enter" ]]; then
  bash -c "$(cat ${JSON.stringify(commandPath)})" >/dev/null 2>&1 &
  printf '%s' "$!" > ${JSON.stringify(launchPidPath)}
fi
exit 0
`)
  chmodSync(tmux, 0o755)
}

async function waitForFixtureLaunchExit(launchPidPath: string): Promise<void> {
  if (!existsSync(launchPidPath)) return
  const pid = Number(readFileSync(launchPidPath, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return
  await waitUntil(() => {
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }, `fixture launch ${pid} to exit`, 2_000)
}

test('no-thread resume replays the authoritative launch payload before later durable sends', { timeout: 20_000, concurrency: false }, async () => {
  const liveBefore = liveSessionsCensus()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const originalLaunchCmd = codexHarness.launchCmd
  const originalLaunchReady = (codexHarness as any).launchReady
  const originalDeliver = codexHarness.deliver
  const home = mkdtempSync(join(tmpdir(), 'spex-no-thread-resume-'))
  process.env.SPEXCODE_HOME = home
  const id = `no-thread-resume-${process.pid}`
  assertIsolatedResumeStore(home, id)
  const commandPath = join(home, 'tmux-command')
  const launchPidPath = join(home, 'launch.pid')
  const bin = join(home, 'bin')
  writeResumeTmuxFixture(bin, commandPath, launchPidPath)
  process.env.PATH = `${bin}:${previousPath}`
  const invocationCount = join(home, 'invocation-count')
  const firstTurnCount = join(home, 'first-turn-count')
  const invocationArgc = join(home, 'invocation-argc')
  const invocationPayload = join(home, 'invocation-payload')
  const invocationThread = join(home, 'invocation-thread')
  const helperPids = join(home, 'helper-pids')
  const helper = join(home, 'adapter-launch.sh')
  writeFileSync(helper, `#!/usr/bin/env bash
set -eu
printf '%s\n' "$$" >> ${JSON.stringify(helperPids)}
n=0; [ ! -f ${JSON.stringify(invocationCount)} ] || n=$(cat ${JSON.stringify(invocationCount)})
printf '%s' "$((n + 1))" > ${JSON.stringify(invocationCount)}
if [ "\${1-}" != "--resume" ]; then
  f=0; [ ! -f ${JSON.stringify(firstTurnCount)} ] || f=$(cat ${JSON.stringify(firstTurnCount)})
  printf '%s' "$((f + 1))" > ${JSON.stringify(firstTurnCount)}
fi
printf '%s' "$#" > ${JSON.stringify(invocationArgc)}
printf '%s' "\${1-}" > ${JSON.stringify(invocationPayload)}
printf '%s' "\${2-}" > ${JSON.stringify(invocationThread)}
exec sleep 30
`)
  chmodSync(helper, 0o755)
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  const resolvedLaunch = 'authoritative resolved first task\n\n- keep every byte\n- [[launch]] context'
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionArtifactPath(id, 'prompt'), 'raw originating prompt must never be replayed')
  writeFileSync(sessionArtifactPath(id, 'launch'), resolvedLaunch)
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch,
    node: 'launch', title: '', name: '', parent: '', status: 'active', proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: '',
    stopped: true, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture',
    launch_cmd: helper, launch_owner: '', create_request_id: '', create_payload_hash: '', launch_readiness_pending: '',
  }, null, 2)}\n`)

  const handedOver: string[] = []
  let pending: Promise<Awaited<ReturnType<typeof resumeSession>>> | null = null
  let rejectPostProofReadiness = false
  try {
    rmSync(sessionArtifactPath(id, 'launch'))
    const missing = await resumeSession(id, { force: true })
    assert.equal(missing.ok, false)
    assert.equal(missing.refused, true)
    assert.match(missing.error || '', /authoritative resolved launch payload is missing/)
    assert.equal(existsSync(commandPath), false, 'missing authoritative payload refuses before any launch transport')
    writeFileSync(sessionArtifactPath(id, 'launch'), resolvedLaunch)

    const proofPath = sessionArtifactPath(id, 'launch.receipt')

    codexHarness.launchCmd = () => helper
    codexHarness.deliver = async (_rec, text) => { handedOver.push(text); return { ok: true } }
    ;(codexHarness as any).launchReady = async () => {
      if (rejectPostProofReadiness) {
        rejectPostProofReadiness = false
        throw new Error('forced post-proof liveness rejection')
      }
      await waitUntil(() => existsSync(invocationPayload), 'recovery launch payload')
      return { proof: { kind: 'fixture-native-id-and-rollout' }, validate: async () => true }
    }

    // This is the durable state left by the first start budget expiring before native identity/rollout proof.
    // A later send is accepted, but cannot become the conversation's first actual task.
    assert.deepEqual(await sendText(id, 'later durable task'), { ok: true })
    await Promise.all([drainSession(id), drainSession(id)])
    assert.deepEqual(handedOver, [], 'later durable send waits behind the authoritative launch payload')
    assert.equal(readFileSync(sessionArtifactPath(id, 'launch'), 'utf8'), resolvedLaunch,
      'the first timed-out start leaves the authoritative payload recoverable')

    rejectPostProofReadiness = true
    pending = resumeSession(id, { force: true })
    await waitUntil(() => existsSync(invocationPayload), 'adapter first-turn acceptance')
    assert.throws(() => stageHarnessLaunchProof(id, 'thread-recovered', `${resolvedLaunch}\nchanged`),
      /differs from the authoritative resolved launch payload/)
    assert.equal(existsSync(sessionArtifactPath(id, 'launch')), true, 'a mismatched proof consumes nothing')
    assert.equal(stageHarnessLaunchProof(id, 'thread-recovered', resolvedLaunch), true)
    assert.equal(stageHarnessLaunchProof(id, 'thread-recovered', resolvedLaunch), true,
      'the adapter may retry the exact same durable proof')
    assert.throws(() => stageHarnessLaunchProof(id, 'another-thread', resolvedLaunch),
      /refusing to replace native launch receipt/)
    const postProofFailure = await pending
    pending = null
    assert.equal(postProofFailure.ok, false)
    assert.match(postProofFailure.error || '', /forced post-proof liveness rejection/)

    assert.equal(readFileSync(invocationArgc, 'utf8'), '1', 'recovery never creates an empty thread')
    assert.equal(readFileSync(invocationPayload, 'utf8'), resolvedLaunch,
      'the resolved launch payload is replayed complete as the first turn')
    assert.equal(readFileSync(invocationCount, 'utf8'), '1', 'recovery creates one thread, without launch retries or duplicates')
    assert.equal(readFileSync(firstTurnCount, 'utf8'), '1')
    assert.deepEqual(handedOver, [], 'post-proof liveness failure does not release later delivery')
    assert.equal(existsSync(sessionArtifactPath(id, 'launch')), false,
      'adapter proof consumes the authoritative payload exactly once')
    assert.equal(existsSync(proofPath), false, 'the committed receipt is consumed after its launch payload')
    const stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.harness_session_id, 'thread-recovered')

    assert.deepEqual(await resumeSession(id, { force: true }), { ok: true })
    await waitUntil(() => readFileSync(invocationCount, 'utf8') === '2', 'idempotent native-thread resume')
    assert.equal(readFileSync(invocationArgc, 'utf8'), '2')
    assert.equal(readFileSync(invocationPayload, 'utf8'), '--resume')
    assert.equal(readFileSync(invocationThread, 'utf8'), 'thread-recovered')
    assert.equal(readFileSync(firstTurnCount, 'utf8'), '1', 'post-proof retry never invokes the first-turn path again')
    assert.deepEqual(handedOver, ['later durable task'], 'retry drains the later task once after resuming the bound thread')
  } finally {
    if (pending) await pending.catch(() => {})
    if (existsSync(helperPids)) for (const raw of readFileSync(helperPids, 'utf8').trim().split('\n')) {
      const pid = Number(raw)
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    if (existsSync(launchPidPath)) {
      const pid = Number(readFileSync(launchPidPath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    const agentPidPath = sessionArtifactPath(id, 'agent.pid')
    if (existsSync(agentPidPath)) {
      const pid = Number(readFileSync(agentPidPath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    codexHarness.launchCmd = originalLaunchCmd
    ;(codexHarness as any).launchReady = originalLaunchReady
    codexHarness.deliver = originalDeliver
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
    assertLiveSessionsUnchanged(liveBefore, 'no-thread resume fixture')
  }
})

test('queued proof rejection releases its slot and post-proof liveness resumes only the bound thread', { timeout: 20_000, concurrency: false }, async () => {
  const liveBefore = liveSessionsCensus()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const originalLaunchCmd = codexHarness.launchCmd
  const originalLaunchReady = (codexHarness as any).launchReady
  const originalDeliver = codexHarness.deliver
  const home = mkdtempSync(join(tmpdir(), 'spex-queued-launch-proof-'))
  process.env.SPEXCODE_HOME = home
  const id = `queued-launch-proof-${process.pid}`
  assertIsolatedResumeStore(home, id)
  const commandPath = join(home, 'tmux-command')
  const launchPidPath = join(home, 'launch.pid')
  const bin = join(home, 'bin')
  writeResumeTmuxFixture(bin, commandPath, launchPidPath)
  process.env.PATH = `${bin}:${previousPath}`
  const invocationCount = join(home, 'invocation-count')
  const invocationArgs = join(home, 'invocation-args')
  const firstTurnCount = join(home, 'first-turn-count')
  const helperPids = join(home, 'helper-pids')
  const helper = join(home, 'adapter-launch.sh')
  writeFileSync(helper, `#!/usr/bin/env bash
set -eu
printf '%s\n' "$$" >> ${JSON.stringify(helperPids)}
n=0; [ ! -f ${JSON.stringify(invocationCount)} ] || n=$(cat ${JSON.stringify(invocationCount)})
printf '%s' "$((n + 1))" > ${JSON.stringify(invocationCount)}
if [ "\${1-}" != "--resume" ]; then
  f=0; [ ! -f ${JSON.stringify(firstTurnCount)} ] || f=$(cat ${JSON.stringify(firstTurnCount)})
  printf '%s' "$((f + 1))" > ${JSON.stringify(firstTurnCount)}
fi
printf '%s' "$*" > ${JSON.stringify(invocationArgs)}
exec sleep 30
`)
  chmodSync(helper, 0o755)
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  const launchPayload = 'queued authoritative first task\n\n- exact resolved context'
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionArtifactPath(id, 'launch'), launchPayload)
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch,
    node: 'launch', title: '', name: '', parent: '', status: 'queued', proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: '',
    stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture',
    launch_cmd: helper, launch_owner: '', create_request_id: '', create_payload_hash: '', launch_readiness_pending: '',
  }, null, 2)}\n`)
  writeFileSync(sessionArtifactPath(id, 'agent.pid'), `${process.pid}\n`)
  writeFileSync(join(sessionStoreDir(id), 'watchers.json'), `${JSON.stringify([{
    watcher: `watcher-${id}`, createdAt: new Date().toISOString(), sources: ['parent'], snapshotPending: 'readiness-timeout-snapshot',
  }])}\n`)

  const proofPath = sessionArtifactPath(id, 'launch.receipt')
  const proof = (overrides: Record<string, unknown> = {}) => ({
    version: 1, sessionId: id, harnessId: 'codex', harnessSessionId: 'thread-queued',
    launchPayloadHash: createHash('sha256').update(launchPayload).digest('hex'), generationId: null,
    ...overrides,
  })
  const handedOver: string[] = []
  let rejectPostProofReadiness = true
  try {
    codexHarness.launchCmd = () => helper
    codexHarness.deliver = async (_rec, text) => { handedOver.push(text); return { ok: true } }
    ;(codexHarness as any).launchReady = async () => {
      if (rejectPostProofReadiness) {
        rejectPostProofReadiness = false
        throw new Error('forced post-proof launch readiness timed out')
      }
      return { proof: { kind: 'fixture-post-proof-live' }, validate: async () => true }
    }
    const rejectProof = async (contents: string, pattern: RegExp) => {
      writeFileSync(proofPath, contents)
      await assert.rejects(drainQueue(), pattern)
      const rejected = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
      assert.match(rejected.note, /launch readiness warning/)
      assert.equal(rejected.harness_session_id, '')
      assert.equal(readFileSync(sessionArtifactPath(id, 'launch'), 'utf8'), launchPayload)
      assert.equal(readFileSync(proofPath, 'utf8'), contents)
      rmSync(proofPath)
    }

    await rejectProof('{broken', /native launch receipt .* unreadable/)
    await rejectProof(`${JSON.stringify(proof({ sessionId: 'wrong-session' }))}\n`, /governed adapter identity/)
    await rejectProof(`${JSON.stringify(proof({ harnessId: 'codex-headless' }))}\n`, /governed adapter identity/)
    await rejectProof(`${JSON.stringify(proof({ launchPayloadHash: 'wrong-payload' }))}\n`, /authoritative resolved launch payload/)
    await rejectProof(`${JSON.stringify(proof({ generationId: 'wrong-generation' }))}\n`, /absent or reclaimed/)

    await drainQueue()
    await waitUntil(() => existsSync(invocationCount), 'queued first-turn launch')
    assert.equal(readFileSync(invocationCount, 'utf8'), '1', 'removing the bad proof makes the next drain launch once')
    assert.equal(readFileSync(firstTurnCount, 'utf8'), '1')
    assert.equal(readFileSync(invocationArgs, 'utf8'), launchPayload)
    assert.deepEqual(await sendText(id, 'later durable task'), { ok: true })
    assert.deepEqual(handedOver, [])
    assert.equal(stageHarnessLaunchProof(id, 'thread-queued', launchPayload), true)
    assert.throws(() => stageHarnessLaunchProof(id, 'wrong-thread', launchPayload), /refusing to replace native launch receipt/)
    await waitUntil(() => /forced post-proof launch readiness timed out/.test(
      JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')).note || ''), 'post-proof queued liveness note')
    await sleep(0)

    const rejectedLiveness = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(rejectedLiveness.harness_session_id, 'thread-queued')
    assert.equal(rejectedLiveness.status, 'active', 'an online worker remains active after readiness timeout')
    assert.equal(rejectedLiveness.stopped, false, 'an online worker is not marked stopped by readiness timeout')
    assert.match(rejectedLiveness.note, /^launch readiness warning:/)
    assert.match(readFileSync(join(sessionStoreDir(id), 'watchers.json'), 'utf8'), /readiness-timeout-snapshot/, 'watcher snapshot debt survives the warning')
    assert.equal(existsSync(sessionArtifactPath(id, 'launch')), false)
    assert.equal(existsSync(proofPath), false)
    assert.equal(readFileSync(invocationCount, 'utf8'), '1')
    assert.deepEqual(handedOver, [], 'post-proof liveness rejection does not drain later delivery')

    writeFileSync(sessionRecordPath(id), `${JSON.stringify({ ...rejectedLiveness, status: 'queued' }, null, 2)}\n`)
    await drainQueue()
    const slotRetry = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.match(slotRetry.note, /authoritative resolved launch payload is missing/,
      'the next drain reaches the record only after the asynchronous slot is released')
    assert.equal(readFileSync(invocationCount, 'utf8'), '1')

    writeFileSync(sessionRecordPath(id), `${JSON.stringify({ ...slotRetry, status: 'active', stopped: true, note: '' }, null, 2)}\n`)
    assert.deepEqual(await resumeSession(id, { force: true }), { ok: true })
    await waitUntil(() => readFileSync(invocationCount, 'utf8') === '2', 'bound-thread resume')
    assert.equal(readFileSync(invocationArgs, 'utf8'), '--resume thread-queued')
    assert.equal(readFileSync(firstTurnCount, 'utf8'), '1', 'identity-only retry never calls the first-turn path')
    assert.deepEqual(handedOver, ['later durable task'])
  } finally {
    if (existsSync(helperPids)) for (const raw of readFileSync(helperPids, 'utf8').trim().split('\n')) {
      const pid = Number(raw)
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    if (existsSync(launchPidPath)) {
      const pid = Number(readFileSync(launchPidPath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    codexHarness.launchCmd = originalLaunchCmd
    ;(codexHarness as any).launchReady = originalLaunchReady
    codexHarness.deliver = originalDeliver
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
    assertLiveSessionsUnchanged(liveBefore, 'queued launch proof fixture')
  }
})

test('resume holds the launch-readiness fence after shared-runtime spawn until the adapter validates', { timeout: 20_000, concurrency: false }, async () => {
  const liveBefore = liveSessionsCensus()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const originalLaunchCmd = codexHeadlessHarness.launchCmd
  const originalSharedRuntimeSpawn = codexHeadlessHarness.sharedRuntimeSpawn
  const originalLaunchReady = (codexHeadlessHarness as any).launchReady
  const home = mkdtempSync(join(tmpdir(), 'spex-resume-ready-delay-'))
  const project = join(home, 'project'); mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  process.env.SPEXCODE_HOME = home
  const bin = join(home, 'bin'); const commandPath = join(home, 'tmux-command'); const launchPidPath = join(home, 'launch.pid')
  writeResumeTmuxFixture(bin, commandPath, launchPidPath)
  process.env.PATH = `${bin}:${previousPath}`
  const id = `resume-ready-delay-${process.pid}`
  assertIsolatedResumeStore(home, id)
  const sharedDir = join(home, 'shared'); mkdirSync(sharedDir)
  const sharedPid = join(sharedDir, 'runtime.pid'); const sharedReceipt = join(sharedDir, 'runtime.detached.json')
  const consumed = join(home, 'shared-spawn-consumed'); const helper = join(home, 'helper.sh')
  const spex = join(process.cwd(), 'bin', 'spex.mjs')
  writeFileSync(helper, `#!/usr/bin/env bash
set -eu
${JSON.stringify(process.execPath)} ${JSON.stringify(spex)} internal shared-runtime-spawn ${JSON.stringify(sharedDir)} ${JSON.stringify(join(sharedDir, 'runtime.log'))} ${JSON.stringify(sharedPid)} ${JSON.stringify(sharedReceipt)} ${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1000)'
touch ${JSON.stringify(consumed)}
`)
  chmodSync(helper, 0o755)
  writeResumeFixtureRecord(id, project, helper)

  let releaseReady!: () => void
  const ready = new Promise<void>((resolve) => { releaseReady = resolve })
  let releaseValidation!: () => void
  const validation = new Promise<void>((resolve) => { releaseValidation = resolve })
  let readinessEntered = false
  let validationEntered = false
  let readinessValidations = 0
  let settled = false
  let settledResult: Awaited<ReturnType<typeof resumeSession>> | null = null
  let pending: Promise<Awaited<ReturnType<typeof resumeSession>>> | null = null
  let runtimeIdentity: { pid: number; startToken: string } | null = null
  try {
    codexHeadlessHarness.launchCmd = () => helper
    ;(codexHeadlessHarness as any).sharedRuntimeSpawn = true
    ;(codexHeadlessHarness as any).launchReady = async () => {
      await waitUntil(() => existsSync(consumed), 'shared-runtime helper spawn')
      readinessEntered = true
      await ready
      return {
        proof: { kind: 'test-ready' },
        validate: async () => {
          validationEntered = true
          await validation
          readinessValidations++
          return true
        },
      }
    }
    pending = resumeSession(id, { force: true })
      .then((result) => { settled = true; settledResult = result; return result })
    await waitUntil(() => readinessEntered || settled, 'adapter readiness entry or early resume result', 15_000)
    assert.equal(settled, false, `resume returned before adapter readiness: ${JSON.stringify(settledResult)}`)
    assert.equal(settled, false, 'resume does not finish at shared-runtime spawn')
    assert.equal(JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')).stopped, true, 'record stays stopped before readiness')
    releaseReady()
    await waitUntil(() => validationEntered, 'post-pending readiness validation')
    const internalPending = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(internalPending.stopped, false, 'the internal candidate crosses its durable pending boundary')
    assert.equal(internalPending.status, 'idle')
    assert.equal(internalPending.launch_readiness_pending?.original?.status, 'active')
    const apiRows = await listSessions(true)
    const apiRow = apiRows.find((row) => row.id === id)
    assert.ok(apiRow, 'sessions API source retains the governed row during validation')
    assert.equal(apiRow.lifecycle, 'active', 'sessions API source projects the exact pre-resume lifecycle')
    assert.equal(apiRow.status, 'offline', 'sessions API source never projects the pending candidate online')
    assert.equal(apiRow.liveness, 'offline', 'sessions API source remains stopped while validation is pending')
    assert.equal(apiRow.note, 'preserve-before-readiness')
    assert.deepEqual(readTimeline(id)?.events ?? [], [], 'pending publication emits no lifecycle event')
    releaseValidation()
    assert.deepEqual(await pending, { ok: true })
    assert.equal(readinessValidations, 1, 'the same fence is validated after the record commit')
    const published = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(published.stopped, false)
    assert.equal(published.status, 'idle')
    assert.equal(published.launch_readiness_pending, '')
    assert.deepEqual((readTimeline(id)?.events ?? []).map((event) => event.kind === 'status'
      ? [event.status, event.proposal, event.note]
      : [event.kind]), [['idle', null, 'preserve-before-readiness']], 'success publishes the real lifecycle exactly once')
    await waitUntil(() => existsSync(sharedPid), 'shared runtime pid')
    const pid = Number(readFileSync(sharedPid, 'utf8').trim()); const runtimeStart = processStartToken(pid)
    if (runtimeStart) runtimeIdentity = { pid, startToken: runtimeStart }
  } finally {
    releaseReady?.()
    releaseValidation?.()
    // The promise owns all record writes. It must settle while the isolated home is still installed; restoring
    // the caller's environment first is what let a failed test continue against the live project store.
    if (pending) await pending.catch(() => {})
    if (!runtimeIdentity && existsSync(sharedPid)) {
      const pid = Number(readFileSync(sharedPid, 'utf8').trim())
      const runtimeStart = processStartToken(pid)
      if (runtimeStart) runtimeIdentity = { pid, startToken: runtimeStart }
    }
    if (runtimeIdentity && processStartToken(runtimeIdentity.pid) === runtimeIdentity.startToken) {
      try { process.kill(runtimeIdentity.pid, 'SIGTERM') } catch { /* already exited */ }
      for (let i = 0; i < 100 && processStartToken(runtimeIdentity.pid) === runtimeIdentity.startToken; i++) await sleep(20)
    }
    codexHeadlessHarness.launchCmd = originalLaunchCmd
    ;(codexHeadlessHarness as any).sharedRuntimeSpawn = originalSharedRuntimeSpawn
    ;(codexHeadlessHarness as any).launchReady = originalLaunchReady
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
    assert.equal(existsSync(home), false, 'delayed resume fixture root is removed exactly')
    assertLiveSessionsUnchanged(liveBefore, 'delayed resume fixture')
  }
})

test('successful resume publishes a capacity-queued record as idle after readiness', serial, async () => {
  const liveBefore = liveSessionsCensus()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const originalLaunchReady = (codexHeadlessHarness as any).launchReady
  const home = mkdtempSync(join(tmpdir(), 'spex-queued-resume-state-'))
  const project = join(home, 'project'); mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  process.env.SPEXCODE_HOME = home
  const id = `queued-resume-state-${process.pid}`
  assertIsolatedResumeStore(home, id)
  const commandPath = join(home, 'tmux-command')
  const launchPidPath = join(home, 'launch.pid')
  const bin = join(home, 'bin'); writeResumeTmuxFixture(bin, commandPath, launchPidPath)
  process.env.PATH = `${bin}:${previousPath}`
  const helper = join(home, 'helper.sh'); writeFileSync(helper, '#!/usr/bin/env bash\nexit 0\n'); chmodSync(helper, 0o755)
  writeResumeFixtureRecord(id, project, helper)
  const queued = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    ...queued,
    status: OWNED_QUEUE_RAW_STATUS,
    stopped: false,
    launch_owner: backendLaunchAuthority(),
  }, null, 2)}\n`)
  try {
    ;(codexHeadlessHarness as any).launchReady = async () => ({
      proof: { kind: 'queued-resume-ready' },
      validate: async () => true,
    })
    assert.deepEqual(await resumeSession(id), { ok: true })

    const stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'idle', 'readiness publishes a live lifecycle, never the pre-launch queue state')
    assert.equal(stored.stopped, false)
    assert.equal(stored.launch_owner, '')
    const publicRow = (await listSessions(true)).find((row) => row.id === id)
    assert.ok(publicRow)
    assert.equal(publicRow.lifecycle, 'idle')
    assert.notEqual(publicRow.status, 'queued')
  } finally {
    ;(codexHeadlessHarness as any).launchReady = originalLaunchReady
    if (existsSync(launchPidPath)) {
      const pid = Number(readFileSync(launchPidPath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
    assertLiveSessionsUnchanged(liveBefore, 'queued resume state fixture')
  }
})

test('a stopped queued record is ineligible for automatic and repeated queue drains', serial, async () => {
  const liveBefore = liveSessionsCensus()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const originalLaunchReady = (claudeHarness as any).launchReady
  const home = mkdtempSync(join(tmpdir(), 'spex-stopped-queue-drain-'))
  const project = join(home, 'project'); mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-C', project, '-c', 'user.name=queue-fixture', '-c', 'user.email=queue@example.test', 'commit', '--allow-empty', '-qm', 'fixture'])
  process.env.SPEXCODE_HOME = home
  const id = `stopped-queue-drain-${process.pid}`
  assertIsolatedResumeStore(home, id)
  const commandPath = join(home, 'tmux-command')
  const launchPidPath = join(home, 'launch.pid')
  const bin = join(home, 'bin'); writeResumeTmuxFixture(bin, commandPath, launchPidPath)
  process.env.PATH = `${bin}:${previousPath}`
  const launches = join(home, 'launches')
  const helper = join(home, 'helper.sh')
  writeFileSync(helper, `#!/usr/bin/env bash\nprintf x >> ${JSON.stringify(launches)}\n`)
  chmodSync(helper, 0o755)
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionArtifactPath(id, 'launch'), 'prepared capacity-queued prompt')
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: project, branch: 'main',
    node: 'launch', title: '', name: '', parent: '', status: OWNED_QUEUE_RAW_STATUS, proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude',
    harness_session_id: id, stopped: false, archived: false, cold_proof: '', adapter_recovery: '',
    launcher: 'fixture', launch_cmd: helper, launch_owner: backendLaunchAuthority(),
    create_request_id: '', create_payload_hash: '', launch_readiness_pending: '',
  }, null, 2)}\n`)
  try {
    ;(claudeHarness as any).launchReady = async () => ({
      proof: { kind: 'stopped-queue-must-not-launch' },
      validate: async () => true,
    })
    assert.equal(await stopSession(id), true, 'public stop commits the stopped record')
    assert.equal(await stopSession(id), true, 're-entering stop is idempotent for the retained queued row')
    await Promise.all([drainQueue(), drainQueue()])
    await sleep(200)
    await drainQueue()

    const stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.stopped, true)
    assert.equal(stored.status, OWNED_QUEUE_RAW_STATUS, 'stop wins over every drain/replay entry')
    assert.equal(existsSync(launches), false, 'no drain launches the stopped prepared prompt')
    assert.equal(canDrainQueued(fromRaw(stored), backendLaunchAuthority()), false)
  } finally {
    ;(claudeHarness as any).launchReady = originalLaunchReady
    if (existsSync(launchPidPath)) {
      const pid = Number(readFileSync(launchPidPath, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
    assertLiveSessionsUnchanged(liveBefore, 'stopped queue drain fixture')
  }
})

test('resume missing, failed, or invalidated readiness preserves the stopped offline record', serial, async (t) => {
  for (const outcome of ['missing', 'timeout', 'thrown', 'invalidated'] as const) await t.test(outcome, async () => {
    const liveBefore = liveSessionsCensus()
    const previousHome = process.env.SPEXCODE_HOME
    const previousPath = process.env.PATH
    const originalLaunchCmd = codexHeadlessHarness.launchCmd
    const originalSharedRuntimeSpawn = codexHeadlessHarness.sharedRuntimeSpawn
    const originalLaunchReady = (codexHeadlessHarness as any).launchReady
    const home = mkdtempSync(join(tmpdir(), `spex-resume-ready-${outcome}-`))
    const project = join(home, 'project'); mkdirSync(project)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    writeFileSync(join(project, 'README.md'), 'fixture\n')
    execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'add', '.'], { cwd: project })
    execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
    process.env.SPEXCODE_HOME = home
    const bin = join(home, 'bin')
    const launchPidPath = join(home, 'launch.pid')
    writeResumeTmuxFixture(bin, join(home, 'tmux-command'), launchPidPath)
    process.env.PATH = `${bin}:${previousPath}`
    const id = `resume-ready-${outcome}-${process.pid}`
    assertIsolatedResumeStore(home, id)
    const helper = join(home, 'helper.sh'); writeFileSync(helper, '#!/usr/bin/env bash\nexit 7\n'); chmodSync(helper, 0o755)
    writeResumeFixtureRecord(id, project, helper)
    const original = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    try {
      codexHeadlessHarness.launchCmd = () => helper
      ;(codexHeadlessHarness as any).sharedRuntimeSpawn = false
      ;(codexHeadlessHarness as any).launchReady = outcome === 'missing'
        ? async () => null
        : async () => ({
            proof: { kind: `test-${outcome}` },
            validate: outcome === 'timeout'
              ? async () => { throw new Error('bounded helper readiness timeout') }
              : outcome === 'thrown'
                ? async () => { throw new Error('adapter validator threw') }
                : async () => false,
          })
      const result = await resumeSession(id, { force: true })
      assert.equal(result.ok, false)
      assert.equal(result.refused, true)
      assert.match(result.error || '', outcome === 'timeout'
        ? /bounded helper readiness timeout/
        : outcome === 'thrown'
          ? /adapter validator threw/
          : /did not become ready|readiness changed/)
      const stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
      assert.deepEqual(stored, original, 'every failed readiness outcome restores the complete pre-resume record')
      assert.equal(codexHeadlessHarness.liveness({ session: id, stopped: stored.stopped }, false), 'offline')
      assert.deepEqual(readTimeline(id)?.events ?? [], [], 'failed readiness emits no lifecycle transition')
    } finally {
      codexHeadlessHarness.launchCmd = originalLaunchCmd
      ;(codexHeadlessHarness as any).sharedRuntimeSpawn = originalSharedRuntimeSpawn
      ;(codexHeadlessHarness as any).launchReady = originalLaunchReady
      if (previousHome === undefined) delete process.env.SPEXCODE_HOME
      else process.env.SPEXCODE_HOME = previousHome
      process.env.PATH = previousPath
      await waitForFixtureLaunchExit(launchPidPath)
      rmSync(home, { recursive: true, force: true })
      assert.equal(existsSync(home), false, `${outcome} resume fixture root is removed exactly`)
      assertLiveSessionsUnchanged(liveBefore, `${outcome} resume fixture`)
    }
  })
})

test('a stale launch-readiness pending record recovers fail-closed before another launch attempt', serial, async () => {
  const liveBefore = liveSessionsCensus()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const originalLaunchReady = (codexHeadlessHarness as any).launchReady
  const home = mkdtempSync(join(tmpdir(), 'spex-resume-ready-stale-'))
  const project = join(home, 'project'); mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=resume-fixture', '-c', 'user.email=resume@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  process.env.SPEXCODE_HOME = home
  const id = `resume-ready-stale-${process.pid}`
  assertIsolatedResumeStore(home, id)
  const commandPath = join(home, 'tmux-command')
  const bin = join(home, 'bin'); writeResumeTmuxFixture(bin, commandPath, join(home, 'launch.pid'))
  process.env.PATH = `${bin}:${previousPath}`
  writeResumeFixtureRecord(id, project, 'true')
  const original = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    ...original,
    status: 'idle',
    stopped: false,
    launch_readiness_pending: {
      version: 1,
      startedAt: Date.now() - 60_000,
      original: {
        status: original.status,
        proposal: original.proposal,
        note: original.note,
        stopped: original.stopped,
        archived: original.archived,
        cold_proof: original.cold_proof,
        adapter_recovery: original.adapter_recovery,
      },
    },
  }, null, 2)}\n`)
  try {
    ;(codexHeadlessHarness as any).launchReady = async () => { throw new Error('stale pending reached launch') }
    const staleRow = (await listSessions(true)).find((row) => row.id === id)
    assert.ok(staleRow)
    assert.equal(staleRow.lifecycle, 'active')
    assert.equal(staleRow.liveness, 'offline', 'a stale durable fence is fail-closed before recovery runs')
    assert.equal(staleRow.status, 'offline')
    const result = await resumeSession(id, { force: true })
    assert.equal(result.ok, false)
    assert.equal(result.refused, true)
    assert.match(result.error || '', /stale launch readiness pending.*retry/i)
    assert.deepEqual(JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')), original,
      'stale recovery restores the exact frozen record and clears pending')
    assert.equal(existsSync(commandPath), false, 'stale recovery occurs before any launch transport')
    assert.deepEqual(readTimeline(id)?.events ?? [], [], 'stale recovery emits no lifecycle event')
  } finally {
    ;(codexHeadlessHarness as any).launchReady = originalLaunchReady
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
    assert.equal(existsSync(home), false, 'stale resume fixture root is removed exactly')
    assertLiveSessionsUnchanged(liveBefore, 'stale resume fixture')
  }
})

test('expired launch readiness residue becomes terminal error/offline during queue recovery', serial, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-launch-limbo-'))
  process.env.SPEXCODE_HOME = home
  const id = `launch-limbo-${process.pid}`
  const worktree = process.cwd()
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionArtifactPath(id, 'launch'), 'authoritative first turn')
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch, node: 'launch', title: '', name: '', parent: '',
    status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex',
    harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex',
    launch_cmd: 'codex', launch_owner: '', launch_readiness_started_at: Date.now() - 31_000, launch_readiness_pending: '',
  }, null, 2)}\n`)
  try {
    await drainQueue()
    await waitUntil(() => JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')).status === 'error', 'terminal launch readiness error')
    const settled = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(settled.stopped, true, 'terminal readiness failure is offline')
    assert.match(settled.note, /^queued launch readiness failed: native identity and first-turn rollout receipt/)
  } finally {
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('stop revalidates the exact leaf after every shared guard before TERM and KILL', serial, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const originalShared = claudeHarness.sharedRuntimes
  const originalCleanup = claudeHarness.cleanupRuntime
  const originalKill = process.kill
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()

  const runCase = async (signal: 'SIGTERM' | 'SIGKILL') => {
    const home = mkdtempSync(join(tmpdir(), `spex-leaf-${signal.toLowerCase()}-`))
    process.env.SPEXCODE_HOME = home
    const id = `leaf-${signal.toLowerCase()}-${process.pid}`
    let shared: { pid: number; startToken: string } | null = null
    let leaf: ReturnType<typeof spawn> | null = null
    let probeCalls = 0
    const attempted: string[] = []
    try {
      const dir = sessionStoreDir(id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(sessionRecordPath(id), `${JSON.stringify({
        session_id: id, governed: true, worktree_path: worktree, branch,
        node: 'host-resource-budget', title: '', name: '', parent: '', status: 'active', proposal: '',
        merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: id,
        stopped: false, archived: false, launcher: 'claude', launch_cmd: 'claude', launch_owner: '',
      }, null, 2)}\n`)

      const pidFile = join(home, 'shared.pid')
      const receiptFile = join(home, 'shared.detached.json')
      shared = spawnDetachedRuntime({
        cwd: home, logFile: join(home, 'shared.log'), pidFile, receiptFile,
        command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
      })
      const leafProgram = signal === 'SIGKILL'
        ? 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
        : 'setInterval(() => {}, 1000)'
      leaf = spawn(process.execPath, ['-e', leafProgram, id], { stdio: 'ignore' })
      let leafStart: string | null = null
      for (let i = 0; i < 50 && !(leafStart = processStartToken(leaf.pid!)); i++) await sleep(20)
      assert.ok(leafStart, `${signal} fixture acquired an exact leaf identity`)
      writeFileSync(sessionArtifactPath(id, 'agent.pid'), `${leaf.pid}\n`)
      writeFileSync(sessionArtifactPath(id, 'agent.identity.json'), `${JSON.stringify({
        version: 1, kind: 'session-leaf', sessionId: id, pid: leaf.pid, startToken: leafStart,
      })}\n`)

      const identityLossCall = signal === 'SIGTERM' ? 2 : 3
      const probe = async (): Promise<SharedRuntimeProbe> => {
        probeCalls++
        if (probeCalls === identityLossCall) {
          const exited = once(leaf!, 'exit')
          originalKill(leaf!.pid!, signal === 'SIGTERM' ? 'SIGTERM' : 'SIGKILL')
          await exited
          assert.equal(processStartToken(leaf!.pid!), null, `${signal} identity is absent before its guard returns`)
        }
        return { healthy: true, references: [] }
      }
      claudeHarness.sharedRuntimes = () => [{ key: `leaf-${signal}`, label: `${signal} leaf fixture`, pidFile, receiptFile, probe }]
      claudeHarness.cleanupRuntime = async () => {}
      process.kill = ((pid: number, next?: number | NodeJS.Signals) => {
        if (pid === leaf!.pid && next && next !== 0) attempted.push(String(next))
        return originalKill(pid, next)
      }) as typeof process.kill

      assert.equal(await stopSession(id), true)
      assert.equal(probeCalls, identityLossCall, `${signal} reached the intended pre-signal guard`)
      assert.deepEqual(attempted, signal === 'SIGTERM' ? [] : ['SIGTERM'], `no ${signal} is attempted after identity loss`)
    } finally {
      process.kill = originalKill
      claudeHarness.sharedRuntimes = originalShared
      claudeHarness.cleanupRuntime = originalCleanup
      if (leaf?.pid && processStartToken(leaf.pid)) {
        try { originalKill(leaf.pid, 'SIGKILL') } catch { /* already exited */ }
      }
      if (shared && processStartToken(shared.pid) === shared.startToken) {
        try { originalKill(shared.pid, 'SIGTERM') } catch { /* already exited */ }
        for (let i = 0; i < 50 && processStartToken(shared.pid) === shared.startToken; i++) await sleep(20)
      }
      rmSync(home, { recursive: true, force: true })
    }
  }

  try {
    await runCase('SIGTERM')
    await runCase('SIGKILL')
  } finally {
    process.kill = originalKill
    claudeHarness.sharedRuntimes = originalShared
    claudeHarness.cleanupRuntime = originalCleanup
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})

test('stop consumes one durable leaf receipt across unreadable, dead-pane, and crash-retry paths', serial, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH || ''
  const previousTarget = process.env.SPEX_TEST_TMUX_TARGET
  const previousPanePid = process.env.SPEX_TEST_TMUX_PANE_PID
  const previousState = process.env.SPEX_TEST_TMUX_STATE
  const previousKillPid = process.env.SPEX_TEST_TMUX_KILL_PID
  const originalShared = claudeHarness.sharedRuntimes
  const originalCleanup = claudeHarness.cleanupRuntime
  const originalKill = process.kill
  const home = mkdtempSync(join(tmpdir(), 'spex-leaf-receipt-stop-'))
  const bin = join(home, 'bin')
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()
  const children: ReturnType<typeof spawn>[] = []
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh
command=
target=
while [ "$#" -gt 0 ]; do
  case "$1" in
    list-panes|kill-session) command="$1" ;;
    -t) shift; target="$1" ;;
  esac
  shift
done
[ "$target" = "$SPEX_TEST_TMUX_TARGET" ] || exit 1
case "$command" in
  list-panes)
    [ ! -e "$SPEX_TEST_TMUX_STATE" ] || exit 1
    printf '%s\\037%s\\037fixture\\n' "$target" "$SPEX_TEST_TMUX_PANE_PID"
    ;;
  kill-session)
    if [ -n "$SPEX_TEST_TMUX_KILL_PID" ]; then kill -HUP "$SPEX_TEST_TMUX_KILL_PID" 2>/dev/null || true; fi
    : > "$SPEX_TEST_TMUX_STATE"
    ;;
  *) exit 1 ;;
esac
`)
  chmodSync(join(bin, 'tmux'), 0o755)
  process.env.SPEXCODE_HOME = home
  process.env.PATH = `${bin}:${previousPath}`
  claudeHarness.sharedRuntimes = () => []
  claudeHarness.cleanupRuntime = async () => {}

  const observeLiveness = (pid: number): 'alive' | 'dead' | 'unknown' => {
    try { originalKill(pid, 0); return 'alive' }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ESRCH') return 'dead'
      if (code === 'EPERM') return 'alive'
      return 'unknown'
    }
  }
  const writeLiveRecord = (id: string, pid: number, startToken: string) => {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: worktree, branch,
      node: 'archive', title: '', name: '', parent: '', status: 'active', proposal: '',
      merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '',
      launcher: 'claude', launch_cmd: 'claude', launch_owner: '',
    }, null, 2)}\n`)
    writeFileSync(sessionArtifactPath(id, 'agent.pid'), `${pid}\n`)
    writeFileSync(sessionArtifactPath(id, 'agent.identity.json'), `${JSON.stringify({
      version: 1, kind: 'session-leaf', sessionId: id, pid, startToken,
    })}\n`)
  }
  const configureTmux = (id: string, marker: string, killPid?: number) => {
    rmSync(marker, { force: true })
    process.env.SPEX_TEST_TMUX_TARGET = id
    process.env.SPEX_TEST_TMUX_PANE_PID = String(process.pid)
    process.env.SPEX_TEST_TMUX_STATE = marker
    if (killPid) process.env.SPEX_TEST_TMUX_KILL_PID = String(killPid)
    else delete process.env.SPEX_TEST_TMUX_KILL_PID
  }
  const startLeaf = async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    children.push(child)
    await waitUntil(() => !!child.pid && !!processStartToken(child.pid), 'leaf process start identity')
    return { child, pid: child.pid!, startToken: processStartToken(child.pid!)! }
  }

  try {
    for (const receiptCase of ['malformed', 'wrong-session'] as const) {
      const id = `leaf-${receiptCase}-${process.pid}`
      const marker = join(home, `${receiptCase}-pane-killed`)
      const leaf = await startLeaf()
      writeLiveRecord(id, leaf.pid, leaf.startToken)
      const receiptFile = sessionArtifactPath(id, 'agent.identity.json')
      const receipt = receiptCase === 'malformed'
        ? '{broken\n'
        : `${JSON.stringify({
          version: 1, kind: 'session-leaf', sessionId: 'some-other-session', pid: leaf.pid, startToken: leaf.startToken,
        })}\n`
      writeFileSync(receiptFile, receipt)
      configureTmux(id, marker)
      const recordBefore = readFileSync(sessionRecordPath(id))
      const pidBefore = readFileSync(sessionArtifactPath(id, 'agent.pid'))
      await assert.rejects(stopSession(id), /receipt is malformed or names a different session/u)
      assert.equal(existsSync(marker), false, `${receiptCase} receipt refuses before exact pane teardown`)
      assert.equal(observeLiveness(leaf.pid), 'alive')
      assert.deepEqual(readFileSync(sessionRecordPath(id)), recordBefore)
      assert.deepEqual(readFileSync(sessionArtifactPath(id, 'agent.pid')), pidBefore)
      assert.equal(readFileSync(receiptFile, 'utf8'), receipt)
      assert.equal(existsSync(worktree), true)
    }

    const unreadableId = `leaf-unreadable-${process.pid}`
    const unreadableMarker = join(home, 'unreadable-pane-killed')
    const unreadable = await startLeaf()
    writeLiveRecord(unreadableId, unreadable.pid, unreadable.startToken)
    configureTmux(unreadableId, unreadableMarker)
    const unreadableRecord = readFileSync(sessionRecordPath(unreadableId))
    const unreadablePid = readFileSync(sessionArtifactPath(unreadableId, 'agent.pid'))
    const unreadableReceipt = readFileSync(sessionArtifactPath(unreadableId, 'agent.identity.json'))
    const resetUnreadable = installSessionLeafProcessProbeForTest({
      liveness: observeLiveness,
      startToken: (pid) => pid === unreadable.pid && existsSync(unreadableMarker) ? null : processStartToken(pid),
    })
    try {
      await assert.rejects(stopSession(unreadableId), /session leaf identity changed before signal/u)
    } finally { resetUnreadable() }
    assert.equal(existsSync(unreadableMarker), true, 'the exact tmux teardown happened before identity became unreadable')
    assert.equal(observeLiveness(unreadable.pid), 'alive', 'an unreadable live process is never signaled')
    assert.deepEqual(readFileSync(sessionRecordPath(unreadableId)), unreadableRecord)
    assert.deepEqual(readFileSync(sessionArtifactPath(unreadableId, 'agent.pid')), unreadablePid)
    assert.deepEqual(readFileSync(sessionArtifactPath(unreadableId, 'agent.identity.json')), unreadableReceipt)
    assert.equal(existsSync(worktree), true)

    const deadId = `leaf-dead-pane-${process.pid}`
    const deadMarker = join(home, 'dead-pane-killed')
    const dead = await startLeaf()
    writeLiveRecord(deadId, dead.pid, dead.startToken)
    const deadExit = once(dead.child, 'exit')
    dead.child.kill('SIGKILL')
    await deadExit
    configureTmux(deadId, deadMarker)
    assert.equal(await stopSession(deadId), true)
    assert.equal(existsSync(deadMarker), true, 'ESRCH permits teardown of the still-present exact pane')
    assert.equal(existsSync(sessionArtifactPath(deadId, 'agent.pid')), false)
    assert.equal(existsSync(sessionArtifactPath(deadId, 'agent.identity.json')), false)
    assert.equal(JSON.parse(readFileSync(sessionRecordPath(deadId), 'utf8')).stopped, true)

    const retryId = `leaf-crash-retry-${process.pid}`
    const retryMarker = join(home, 'retry-pane-killed')
    const retry = await startLeaf()
    writeLiveRecord(retryId, retry.pid, retry.startToken)
    configureTmux(retryId, retryMarker, retry.pid)
    const retryRecord = readFileSync(sessionRecordPath(retryId))
    let deadObservations = 0
    const resetInterrupted = installSessionLeafProcessProbeForTest({
      startToken: processStartToken,
      liveness: (pid) => {
        const observed = observeLiveness(pid)
        if (pid === retry.pid && observed === 'dead') return ++deadObservations === 1 ? 'dead' : 'unknown'
        return observed
      },
    })
    try {
      await assert.rejects(stopSession(retryId), /exact leaf teardown remains unknown/u)
    } finally { resetInterrupted() }
    await waitUntil(() => observeLiveness(retry.pid) === 'dead', 'tmux-killed receipt leaf')
    assert.deepEqual(readFileSync(sessionRecordPath(retryId)), retryRecord)
    assert.equal(existsSync(sessionArtifactPath(retryId, 'agent.pid')), true)
    assert.equal(existsSync(sessionArtifactPath(retryId, 'agent.identity.json')), true)
    delete process.env.SPEX_TEST_TMUX_KILL_PID
    assert.equal(await stopSession(retryId), true, 'retry proves the receipt leaf dead after tmux reparent/crash boundary')
    assert.equal(existsSync(sessionArtifactPath(retryId, 'agent.pid')), false)
    assert.equal(existsSync(sessionArtifactPath(retryId, 'agent.identity.json')), false)
    assert.equal(JSON.parse(readFileSync(sessionRecordPath(retryId), 'utf8')).stopped, true)
  } finally {
    claudeHarness.sharedRuntimes = originalShared
    claudeHarness.cleanupRuntime = originalCleanup
    for (const child of children) if (child.pid && observeLiveness(child.pid) === 'alive') {
      try { originalKill(child.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    if (previousTarget === undefined) delete process.env.SPEX_TEST_TMUX_TARGET
    else process.env.SPEX_TEST_TMUX_TARGET = previousTarget
    if (previousPanePid === undefined) delete process.env.SPEX_TEST_TMUX_PANE_PID
    else process.env.SPEX_TEST_TMUX_PANE_PID = previousPanePid
    if (previousState === undefined) delete process.env.SPEX_TEST_TMUX_STATE
    else process.env.SPEX_TEST_TMUX_STATE = previousState
    if (previousKillPid === undefined) delete process.env.SPEX_TEST_TMUX_KILL_PID
    else process.env.SPEX_TEST_TMUX_KILL_PID = previousKillPid
    rmSync(home, { recursive: true, force: true })
  }
})


test('public close files queued and unbound rows without entering the unrelated shared-runtime guard', serial, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousCwd = process.cwd()
  const originalShared = codexHarness.sharedRuntimes
  const originalCleanup = codexHarness.cleanupRuntime
  let cleanupCalls = 0
  const home = mkdtempSync(join(tmpdir(), 'spex-queued-close-'))
  const project = join(home, 'project')
  const branches: string[] = []
  const paths: string[] = []
  mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main', project])
  execFileSync('git', ['-C', project, '-c', 'user.name=Queue Close Fixture', '-c', 'user.email=queue-close@example.test', 'commit', '--allow-empty', '-q', '-m', 'fixture: queue close root'])
  process.chdir(project)
  const main = mainRoot()
  process.env.SPEXCODE_HOME = home

  const prepare = (suffix: string, thread = '') => {
    const id = `queued-close-${suffix}-${process.pid}`
    const branch = `test/queued-close-${suffix}-${process.pid}-${Date.now()}`
    const path = join(home, `${suffix}-worktree`)
    execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '-b', branch, path, 'main'])
    assert.notEqual(execFileSync('git', ['-C', main, 'rev-parse', '--verify', `${branch}^{commit}`], { encoding: 'utf8' }).trim(), '')
    branches.push(branch); paths.push(path)
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: path, branch,
      node: 'archive', title: '', name: '', parent: '', status: OWNED_QUEUE_RAW_STATUS, proposal: '',
      merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: thread,
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex',
      launch_cmd: 'codex', launch_owner: 'queued-close-test-owner',
    }, null, 2)}\n`)
    writeFileSync(sessionArtifactPath(id, 'launch'), 'prepared prompt')
    return { id, branch, path }
  }

  codexHarness.sharedRuntimes = () => [{
    key: 'codex-app-server', label: 'Codex app-server', pidFile: join(home, 'shared.pid'), receiptFile: join(home, 'shared.detached.json'),
    residency: async () => ({ healthy: true, referenceIds: ['unrelated-unowned-a', 'unrelated-unowned-b'] }),
    probe: async () => { throw new Error('never-launched queue close must not enter the shared-runtime guard') },
  }]
  codexHarness.cleanupRuntime = async () => { cleanupCalls++ }

  try {
    const clean = prepare('clean')
    assert.equal(await closeSession(clean.id), true)
    assert.equal(existsSync(clean.path), false, 'queue close removes the prepared worktree')
    assert.equal(existsSync(sessionRecordPath(clean.id)), true, 'queue close retains its record')
    assert.notEqual(execFileSync('git', ['-C', main, 'branch', '--list', clean.branch], { encoding: 'utf8' }).trim(), '', 'queue close retains the prepared branch')
    assert.notEqual(execFileSync('git', ['-C', main, 'rev-parse', '--verify', `refs/spex-archive/${clean.id}^{commit}`], { encoding: 'utf8' }).trim(), '', 'queue close publishes its archive ref')
    assert.equal(cleanupCalls, 0, 'never-launched queue close does not invoke adapter cleanup')

    const unbound = prepare('unbound')
    const raw = JSON.parse(readFileSync(sessionRecordPath(unbound.id), 'utf8'))
    writeFileSync(sessionRecordPath(unbound.id), `${JSON.stringify({ ...raw, status: 'active', launch_owner: '' }, null, 2)}\n`)
    rmSync(sessionArtifactPath(unbound.id, 'launch'))
    assert.equal(await closeSession(unbound.id), true)
    assert.equal(existsSync(unbound.path), false, 'unbound launch residue close removes the clean worktree')
    assert.equal(existsSync(sessionRecordPath(unbound.id)), true, 'unbound launch residue close retains its record')
    assert.notEqual(execFileSync('git', ['-C', main, 'branch', '--list', unbound.branch], { encoding: 'utf8' }).trim(), '', 'unbound launch residue close retains its branch')
    assert.equal(cleanupCalls, 1, 'unbound residue cleanup reaches only its adapter-local cleanup seam')

    const unboundDirty = prepare('unbound-dirty')
    const dirtyRaw = JSON.parse(readFileSync(sessionRecordPath(unboundDirty.id), 'utf8'))
    writeFileSync(sessionRecordPath(unboundDirty.id), `${JSON.stringify({ ...dirtyRaw, status: 'active', launch_owner: '' }, null, 2)}\n`)
    rmSync(sessionArtifactPath(unboundDirty.id, 'launch'))
    writeFileSync(join(unboundDirty.path, 'uncommitted.txt'), 'owned work\n')
    assert.equal(await closeSession(unboundDirty.id), true)
    assert.equal(execFileSync('git', ['-C', main, 'show', `refs/spex-archive/${unboundDirty.id}:uncommitted.txt`], { encoding: 'utf8' }), 'owned work\n', 'dirty unbound work is preserved in its archive ref')
    assert.equal(existsSync(sessionRecordPath(unboundDirty.id)), true, 'dirty unbound residue retains its record')
    assert.equal(existsSync(unboundDirty.path), false, 'dirty unbound residue removes its filed worktree')

    const dirty = prepare('dirty')
    writeFileSync(join(dirty.path, 'uncommitted.txt'), 'owned work\n')
    assert.equal(await closeSession(dirty.id), true)
    assert.equal(execFileSync('git', ['-C', main, 'show', `refs/spex-archive/${dirty.id}:uncommitted.txt`], { encoding: 'utf8' }), 'owned work\n', 'dirty queued work is preserved in its archive ref')
    assert.equal(existsSync(sessionRecordPath(dirty.id)), true, 'dirty queued close retains its record')
    assert.equal(existsSync(dirty.path), false, 'dirty queued close removes its filed worktree')

    const threaded = prepare('threaded', `unexpected-thread-${process.pid}`)
    await assert.rejects(closeSession(threaded.id), /record has a target thread or is no longer queued/)
    assert.equal(existsSync(sessionRecordPath(threaded.id)), true, 'thread ambiguity preserves the queued record')

    const pidArtifact = prepare('pid-artifact')
    writeFileSync(sessionArtifactPath(pidArtifact.id, 'agent.pid'), 'not-a-pid\n')
    await assert.rejects(closeSession(pidArtifact.id), /target leaf PID artifact is unreadable/)
    assert.equal(existsSync(sessionRecordPath(pidArtifact.id)), true, 'unreadable PID ambiguity preserves the queued record')

    const ahead = prepare('ahead')
    execFileSync('git', ['-c', 'user.name=Queue Close Fixture', '-c', 'user.email=queue-close@example.test', '-C', ahead.path, 'commit', '--allow-empty', '-q', '-m', 'fixture: owned queue work'])
    assert.equal(await closeSession(ahead.id), true)
    assert.equal(existsSync(sessionRecordPath(ahead.id)), true, 'ahead queued close retains its record')
    assert.notEqual(execFileSync('git', ['-C', main, 'branch', '--list', ahead.branch], { encoding: 'utf8' }).trim(), '', 'ahead queued close retains its branch')

    const socket = prepare('socket')
    const socketPath = stampRvSock(socket.id, home)
    const listener = createServer()
    listener.listen(socketPath)
    await once(listener, 'listening')
    try {
      await assert.rejects(closeSession(socket.id), /target rendezvous transport already exists/)
      assert.equal(existsSync(sessionRecordPath(socket.id)), true, 'socket ambiguity preserves the queued record')
    } finally {
      listener.close()
      await once(listener, 'close')
      rmSync(socketPath, { force: true })
    }

  } finally {
    codexHarness.sharedRuntimes = originalShared
    codexHarness.cleanupRuntime = originalCleanup
    for (const path of paths) {
      if (existsSync(path)) {
        try { execFileSync('git', ['-C', main, 'worktree', 'remove', '--force', path]) } catch { /* best-effort fixture cleanup */ }
      }
    }
    for (const branch of branches) {
      try { execFileSync('git', ['-C', main, 'branch', '-D', branch], { stdio: 'ignore' }) } catch { /* already removed */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.chdir(previousCwd)
    rmSync(home, { recursive: true, force: true })
  }
})

test('launch retry log names the fast exit without guessing a daemon race', serial, () => {
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
test('a launch failure the harness itself called settled is attempted exactly once', serial, () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-launch-class-'))
  process.env.SPEXCODE_HOME = home
  // The classifier reads the tmux PANE, so the stub must run inside one — and the stub prints its settled
  // failure to STDOUT, the stream real reclaude uses. An earlier version of this test printed to stderr and
  // passed against a stderr-only implementation that could not classify a real harness at all.
  // `stale` pre-seeds the pane with a settled-failure line from an EARLIER run before the launch line is
  // typed — the scrollback condition that must not condemn the current attempt.
  // ONE SOCKET PER CASE: sharing one made the last case's kill end the server while the next case's
  // new-session was still starting ("server exited unexpectedly") — a flake in this test, not the product.
  // Each case owns its socket and reaps that exact server itself; nothing waits on a guessed interval.
  // TMUX_TMPDIR puts every socket inside this test's own temp dir, so the servers it starts leave nothing in
  // the shared /tmp/tmux-<uid> (kill-server reaps the server but leaves the socket FILE) — rmSync(home) below
  // takes them with it.
  const tmuxEnv = { ...process.env, TMUX_TMPDIR: home }
  const tmux = (...args: string[]) => execFileSync('tmux', args, { env: tmuxEnv })
  const tmuxTry = (...args: string[]) => spawnSync('tmux', args, { env: tmuxEnv, encoding: 'utf8' })
  const run = (name: string, stubBody: string, stale = false): { attempts: number; pane: string } => {
    const sock = `spex-launch-class-${process.pid}-${name}`
    const counter = join(home, `${name}.attempts`)
    const stub = join(home, `${name}.sh`)
    writeFileSync(stub, `echo x >> ${JSON.stringify(counter)}\n${stubBody}\nexit 1\n`)
    const script = launchScript(name, '', claudeHarness, `bash ${stub}`)
    // exactly how the product starts a worker: an idle shell window, then the launch line typed into it. The
    // shell outlives the script, so the pane keeps everything the run printed — no remain-on-exit race.
    tmux('-L', sock, 'new-session', '-d', '-s', name, '-x', '200', '-y', '80')
    if (stale) {
      tmux('-L', sock, 'send-keys', '-t', name, '-l', '--', 'echo "No conversation found with session ID: an-earlier-run"')
      tmux('-L', sock, 'send-keys', '-t', name, 'Enter')
      spawnSync('sleep', ['0.5'])
    }
    tmux('-L', sock, 'send-keys', '-t', name, '-l', '--', `bash ${script}`)
    tmux('-L', sock, 'send-keys', '-t', name, 'Enter')
    const deadline = Date.now() + 60_000
    let pane = ''
    for (;;) {
      pane = tmuxTry('-L', sock, 'capture-pane', '-p', '-S', '-400', '-t', name).stdout ?? ''
      if (/not retrying/.test(pane) || /attempt 3/.test(pane) || Date.now() > deadline) break
      spawnSync('sleep', ['0.5'])
    }
    const attempts = readFileSync(counter, 'utf8').split('\n').filter(Boolean).length
    tmuxTry('-L', sock, 'kill-server')   // this case's server, by its exact socket
    return { attempts, pane }
  }
  try {
    // stdout on purpose: that is where real reclaude prints this line.
    const settled = run('settled', 'echo "No conversation found with session ID: deadbeef"')
    assert.equal(settled.attempts, 1, `a settled failure is spent ONCE, not three times\n${settled.pane}`)
    assert.match(settled.pane, /No conversation found with session ID/, "the harness's own reason stays visible on the pane")
    assert.match(settled.pane, /retrying cannot fix \(see above\); not retrying/)
    assert.doesNotMatch(settled.pane, /attempt 2/)

    const unclassifiable = run('unclassifiable', 'echo "the wrapper fell over"')
    assert.equal(unclassifiable.attempts, 3, `an unclassifiable fast exit keeps the bounded readiness retry\n${unclassifiable.pane}`)
    assert.match(unclassifiable.pane, /fast launcher exit before readiness; retrying/)

    // the scrollback trap: an OLD settled-failure line is already on the pane, but this run's failure is not
    // one — it must still get all three attempts, or a stale line would cut a recoverable launch.
    const stale = run('stale', 'echo "the wrapper fell over"', true)
    assert.match(stale.pane, /No conversation found with session ID: an-earlier-run/, 'the stale line really was on the pane')
    assert.equal(stale.attempts, 3, `a stale settled line must not condemn an unrelated fast exit\n${stale.pane}`)
    assert.doesNotMatch(stale.pane, /retrying cannot fix/, 'nothing was misclassified as settled')

    // and with the same stale line present, a genuine settled failure this run is STILL caught once
    const staleAndSettled = run('stale-settled', 'echo "No conversation found with session ID: this-run"', true)
    assert.equal(staleAndSettled.attempts, 1, `a real settled failure is still spent once\n${staleAndSettled.pane}`)
    assert.match(staleAndSettled.pane, /retrying cannot fix/)
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

// the transport's own settled failures, answered BEFORE a window is opened: a launch that cannot succeed is
// refused once with its own code, never attempted and retried on a wall clock.
test('launchPreflight refuses a launch that cannot succeed, naming which fact settled it', serial, () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-preflight-'))
  const base: SessRec = {
    session: 'preflight-test', governed: true, worktreePath: join(home, 'gone'), branch: null, node: null,
    title: null, name: null, parent: null, status: 'idle', proposal: null, merges: 0, note: null,
    sortKey: null, createdAt: 1, harness: 'claude', harnessSessionId: null, runtimeStartToken: null, stopped: false, archived: false, closedAt: null,
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

test('one-shot headless launch does not retry a successful fast exit', serial, () => {
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

test('a failed creation-time materialize is reported loud and stamped on the record note', serial, () => {
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
      harness: 'claude', harnessSessionId: null, runtimeStartToken: null, stopped: false, archived: false, closedAt: null,
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

test('machine turn failures share one active-only error projection', serial, () => {
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
    const nativeNote = turnFailureNote('codex', {
      message: '  context   window exceeded  ',
      completedAt: 1_700_000_000,
    })
    assert.equal(nativeNote, 'codex turn failed at 2023-11-14T22:13:20.000Z: context window exceeded')
    assert.equal(markTurnFailure(id, nativeNote), true)
    stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'error')
    assert.equal(stored.note, nativeNote)

    stored.status = 'active'
    writeFileSync(sessionRecordPath(id), JSON.stringify(stored, null, 2) + '\n')
    assert.equal(markHeadlessTurnFailure(id, 'opencode-headless', '0'), false, 'zero exit never manufactures an error')
    stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'active')
    assert.equal(stored.note, nativeNote)

    stored.stopped = true
    writeFileSync(sessionRecordPath(id), JSON.stringify(stored, null, 2) + '\n')
    assert.equal(markTurnFailure(id, 'late failure after stop'), false, 'explicit stop wins over a late native completion')
    stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(stored.status, 'active')
    assert.equal(stored.note, nativeNote)
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prevHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('turn failure observer retry is bounded exponential backoff', serial, () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(turnFailureRetryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000])
})

test('owned queues are public-authority leased and raw-state fenced from legacy drainers', serial, () => {
  const publicAuthority = backendLaunchAuthority({
    SPEXCODE_API_URL: 'https://operator:secret@127.0.0.1:8787/api/?token=private#fragment',
    PORT: '44725',
  })
  assert.equal(publicAuthority, 'https://127.0.0.1:8787/api')
  assert.doesNotMatch(publicAuthority, /operator|secret|token|44725/)

  const base: SessRec = {
    session: 'owned-q', governed: true, worktreePath: '/wt/q', branch: 'node/q', node: null, title: null,
    name: null, parent: null, status: 'queued', proposal: null, merges: 0, note: null, sortKey: null,
    createdAt: 1, harness: 'codex', harnessSessionId: null, runtimeStartToken: null, stopped: false, archived: false, closedAt: null, launcher: 'codex', launchCmd: 'codex',
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
  assert.equal(canDrainQueued({ status: 'queued', launchOwner: null, stopped: false }, 'http://127.0.0.1:8956'), true, 'legacy unowned queues remain adoptable')
  assert.equal(canDrainQueued({ status: 'queued', launchOwner: null, stopped: true }, 'http://127.0.0.1:8956'), false, 'explicit stop fences even a legacy unowned queue')
})

test('a launch establishes identity: inherited session ids are stripped, this session\'s is set', serial, () => {
  const prevHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-identity-'))
  process.env.SPEXCODE_HOME = home
  try {
    const script = readFileSync(launchScript('identity-launch-test', "'hi'", claudeHarness, 'true'), 'utf8')
    // the pane inherits the tmux SERVER's env, so whatever session started that server would otherwise ride
    // along into every worker — the leak class behind github#76. The launch strips them all, then sets its own.
    for (const v of sessionIdentityEnvVars()) assert.match(script, new RegExp(`env[^\\n]*-u ${v}\\b`), v)
    assert.match(script, /SPEXCODE_SESSION_ID=identity-launch-test/)
    assert.match(script, /SPEXCODE_SESSION_IDENTITY_VARS=/)
    assert.ok(sessionIdentityEnvVars().includes('SPEXCODE_SESSION_ID'))
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME; else process.env.SPEXCODE_HOME = prevHome
  }
})

test('the spawner pointer names the parent worktree and stays quiet without one', serial, () => {
  const parent = fromRaw({
    session_id: 'aaaaaaaa-1111-2222-3333-444444444444', governed: true,
    worktree_path: '/repo/.worktrees/parent-node-aaaa', branch: 'node/parent-node-aaaa',
    node: 'spawner-pointer', title: 'teach the child where I work', name: null, parent: null,
    status: 'active', proposal: null, merges: 0, note: null, sortkey: null, createdAt: 1,
    harness: 'claude', launcher: 'reclaude', launch_cmd: 'claude',
  })

  const clause = spawnerClause(parent)
  assert.ok(clause.startsWith('\n\n'), 'appends after the spec pointer rather than running into it')
  assert.match(clause, /session `aaaaaaaa`/, 'names the spawner by short id')
  assert.match(clause, /\(teach the child where I work\)/, 'carries the spawner label when it has one')
  assert.match(clause, /\/repo\/\.worktrees\/parent-node-aaaa/, 'points at the spawner worktree')
  assert.match(clause, /on branch `node\/parent-node-aaaa`/)
  assert.match(clause, /branched from `[^`]+`, so it does NOT contain/, 'states why the child cannot see that work')
  assert.match(clause, /Read only: never write into another session's worktree/)
  assert.doesNotMatch(clause, /## |raw source/, 'a pointer, never a spec body')

  assert.equal(spawnerClause(null), '', 'a top-level launch gets no clause')
  assert.equal(
    spawnerClause({ ...parent, worktreePath: '' }),
    '',
    'fail-quiet by absence: a parent record with no worktree appends nothing',
  )
})
