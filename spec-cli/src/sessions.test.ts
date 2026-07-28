import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeHarness, codexHarness, codexHeadlessHarness, sessionIdentityEnvVars, stampRvSock, type SharedRuntimeProbe } from './harness.js'
import { processStartToken } from './process-identity.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'
import { OWNED_QUEUE_RAW_STATUS, backendLaunchAuthority, bootstrapMaterialize, canDrainQueued, closeSession, composeCommandPrompt, fromRaw, launchPreflight, launchScript, markHeadlessTurnFailure, rawLifecycleStatus, resolveCommandPrompt, resumeSession, sessionCreateRequest, spawnerClause, stopSession, type Session, type SessRec } from './sessions.js'
import { runtimeRoot, sessionRecordPath, sessionArtifactPath, sessionStoreDir } from './layout.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const waitUntil = async (check: () => boolean, label: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(20)
  }
}

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

function writeResumeFixtureRecord(id: string, worktree: string, launchCmd: string): void {
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch: 'main',
    node: 'maintenance-lease', title: '', name: '', parent: '', status: 'idle', proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex-headless',
    harness_session_id: `thread-${id}`, stopped: true, archived: false, cold_proof: '', adapter_recovery: '',
    launcher: 'fixture', launch_cmd: launchCmd, launch_owner: '',
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

test('maintenance resume holds its parent ticket after delegated spawn until adapter launch readiness', { timeout: 20_000 }, async () => {
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
  const sharedDir = join(home, 'shared'); mkdirSync(sharedDir)
  const sharedPid = join(sharedDir, 'runtime.pid'); const sharedScope = join(sharedDir, 'runtime.scope')
  const consumed = join(home, 'delegate-consumed'); const helper = join(home, 'helper.sh')
  const spex = join(process.cwd(), 'bin', 'spex.mjs')
  writeFileSync(helper, `#!/usr/bin/env bash
set -eu
${JSON.stringify(process.execPath)} ${JSON.stringify(spex)} internal shared-runtime-spawn ${JSON.stringify(sharedDir)} ${JSON.stringify(join(sharedDir, 'runtime.log'))} ${JSON.stringify(sharedPid)} ${JSON.stringify(sharedScope)} ${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1000)'
touch ${JSON.stringify(consumed)}
`)
  chmodSync(helper, 0o755)
  writeResumeFixtureRecord(id, project, helper)
  const token = '81'.repeat(32)
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  const leasePath = join(runtimeRoot(), 'session-maintenance.json')
  mkdirSync(runtimeRoot(), { recursive: true })
  writeFileSync(leasePath, `${JSON.stringify({
    version: 1, state: 'active', epoch: 41, tokenHash: createHash('sha256').update(token).digest('hex'),
    owner: { instanceId: 'resume-ready-fixture', pid: process.pid, startToken }, heartbeatDeadline: Date.now() + 60_000,
    capabilities: [{ capability: { op: 'resume', sessionId: id, force: true }, state: 'unused' }], tickets: [], delegates: [],
  }, null, 2)}\n`)

  let releaseReady!: () => void
  const ready = new Promise<void>((resolve) => { releaseReady = resolve })
  let readinessEntered = false
  let readinessValidations = 0
  let settled = false
  let runtimeIdentity: { pid: number; startToken: string } | null = null
  try {
    codexHeadlessHarness.launchCmd = () => helper
    ;(codexHeadlessHarness as any).sharedRuntimeSpawn = true
    ;(codexHeadlessHarness as any).launchReady = async () => {
      await waitUntil(() => existsSync(consumed), 'delegated helper consumption')
      readinessEntered = true
      await ready
      return {
        proof: { kind: 'test-ready' },
        validate: async () => { readinessValidations++; return true },
      }
    }
    const pending = resumeSession(id, { force: true, authorization: { token, epoch: 41 } })
      .then((result) => { settled = true; return result })
    await waitUntil(() => readinessEntered, 'adapter readiness entry')
    const during = JSON.parse(readFileSync(leasePath, 'utf8'))
    assert.equal(settled, false, 'resume does not finish at FIFO handoff or delegate consumption')
    assert.equal(during.tickets.some((ticket: any) => ticket.operation === 'resume' && ticket.sessionId === id), true)
    assert.equal(during.capabilities[0]?.state, 'inflight')
    assert.equal(during.delegates.length, 1)
    assert.equal(during.delegates[0]?.state, 'completed')
    assert.equal(JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')).stopped, true, 'record stays stopped before readiness')
    releaseReady()
    assert.deepEqual(await pending, { ok: true })
    assert.equal(readinessValidations, 1, 'the same fence is validated after the record commit')
    assert.equal(JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')).stopped, false)
    await waitUntil(() => existsSync(sharedPid), 'delegated runtime pid')
    const pid = Number(readFileSync(sharedPid, 'utf8').trim()); const runtimeStart = processStartToken(pid)
    if (runtimeStart) runtimeIdentity = { pid, startToken: runtimeStart }
  } finally {
    releaseReady?.()
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
  }
})

test('resume missing, failed, or invalidated readiness preserves the stopped offline record', async (t) => {
  for (const outcome of ['missing', 'timeout', 'invalidated'] as const) await t.test(outcome, async () => {
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
    const bin = join(home, 'bin'); writeResumeTmuxFixture(bin, join(home, 'tmux-command'), join(home, 'launch.pid'))
    process.env.PATH = `${bin}:${previousPath}`
    const id = `resume-ready-${outcome}-${process.pid}`
    const helper = join(home, 'helper.sh'); writeFileSync(helper, '#!/usr/bin/env bash\nexit 7\n'); chmodSync(helper, 0o755)
    writeResumeFixtureRecord(id, project, helper)
    try {
      codexHeadlessHarness.launchCmd = () => helper
      ;(codexHeadlessHarness as any).sharedRuntimeSpawn = false
      ;(codexHeadlessHarness as any).launchReady = outcome === 'missing'
        ? async () => null
        : outcome === 'timeout'
          ? async () => { throw new Error('bounded helper readiness timeout') }
          : async () => ({ proof: { kind: 'test-invalidated' }, validate: async () => false })
      const result = await resumeSession(id, { force: true })
      assert.equal(result.ok, false)
      assert.equal(result.refused, true)
      assert.match(result.error || '', outcome === 'timeout' ? /bounded helper readiness timeout/ : /did not become ready|readiness changed/)
      const stored = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
      assert.equal(stored.stopped, true)
      assert.equal(codexHeadlessHarness.liveness({ session: id, stopped: stored.stopped }, false), 'offline')
    } finally {
      codexHeadlessHarness.launchCmd = originalLaunchCmd
      ;(codexHeadlessHarness as any).sharedRuntimeSpawn = originalSharedRuntimeSpawn
      ;(codexHeadlessHarness as any).launchReady = originalLaunchReady
      if (previousHome === undefined) delete process.env.SPEXCODE_HOME
      else process.env.SPEXCODE_HOME = previousHome
      process.env.PATH = previousPath
      rmSync(home, { recursive: true, force: true })
    }
  })
})

test('stop revalidates the exact leaf after every shared guard before TERM and KILL', async () => {
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
      const isolationFile = join(home, 'shared.scope')
      shared = spawnDetachedRuntime({
        cwd: home, logFile: join(home, 'shared.log'), pidFile, isolationFile,
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
      claudeHarness.sharedRuntimes = () => [{ key: `leaf-${signal}`, label: `${signal} leaf fixture`, pidFile, isolationFile, probe }]
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

test('closing a proven-cold archive ignores unrelated shared refs but rejects target runtime ambiguity without signaling', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const originalShared = codexHarness.sharedRuntimes
  const originalColdPreflight = codexHarness.coldPreflight
  const originalColdRetirementPreflight = codexHarness.coldRetirementPreflight
  const originalCleanup = codexHarness.cleanupRuntime
  const home = mkdtempSync(join(tmpdir(), 'spex-cold-close-'))
  process.env.SPEXCODE_HOME = home
  let residentIds: string[] = ['unrelated-unowned-thread']
  let coldPreflightCalls = 0
  let leaf: ReturnType<typeof spawn> | null = null

  const writeColdRecord = (id: string, thread: string) => {
    const dir = sessionStoreDir(id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: join(home, `${id}-absent-worktree`), branch: '',
      node: 'archive', title: '', name: '', parent: '', status: 'asking', proposal: '',
      merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: thread,
      stopped: true, archived: true, cold_proof: `cold-v1|codex|${id}|thread:${thread}`,
      adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
    }, null, 2)}\n`)
  }

  codexHarness.sharedRuntimes = () => [{
    key: 'codex-app-server', label: 'Codex app-server', pidFile: join(home, 'shared.pid'), isolationFile: join(home, 'shared.scope'),
    residency: async () => ({ healthy: true, referenceIds: residentIds }),
    probe: async () => { throw new Error('cold retirement must not enter the full shared-root ownership guard') },
  }]
  codexHarness.coldPreflight = async () => { throw new Error('cold retirement must not use mutation preflight') }
  codexHarness.coldRetirementPreflight = async (rec) => {
    coldPreflightCalls++
    return rec.harnessSessionId && residentIds.includes(rec.harnessSessionId)
      ? { ok: false, reason: `target adapter thread ${rec.harnessSessionId} is loaded` }
      : { ok: true, alreadyCold: true }
  }
  codexHarness.cleanupRuntime = async () => { throw new Error('cold retirement must not invoke adapter cleanup') }

  try {
    const safeId = `cold-close-safe-${process.pid}`
    const safeThread = `target-safe-${process.pid}`
    writeColdRecord(safeId, safeThread)
    assert.equal(await closeSession(safeId), true)
    assert.equal(existsSync(sessionStoreDir(safeId)), false, 'proven-cold target is permanently retired')
    assert.equal(coldPreflightCalls, 1, 'target collection is checked without the full shared-root guard')

    const loadedId = `cold-close-loaded-${process.pid}`
    const loadedThread = `target-loaded-${process.pid}`
    writeColdRecord(loadedId, loadedThread)
    residentIds = ['unrelated-unowned-thread', loadedThread]
    await assert.rejects(closeSession(loadedId), /target adapter thread .* is loaded/)
    assert.equal(existsSync(sessionRecordPath(loadedId)), true, 'loaded target ambiguity preserves the shelf record')

    const pidId = `cold-close-pid-${process.pid}`
    const pidThread = `target-pid-${process.pid}`
    residentIds = ['unrelated-unowned-thread']
    writeColdRecord(pidId, pidThread)
    leaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    for (let i = 0; i < 50 && !processStartToken(leaf.pid!); i++) await sleep(20)
    writeFileSync(sessionArtifactPath(pidId, 'agent.pid'), `${leaf.pid}\n`)
    await assert.rejects(closeSession(pidId), /target leaf PID .* live or recycled/)
    assert.ok(processStartToken(leaf.pid!), 'ambiguous target PID is left alive; cold close sends no signal')
    assert.equal(existsSync(sessionRecordPath(pidId)), true, 'PID ambiguity preserves the shelf record')
  } finally {
    codexHarness.sharedRuntimes = originalShared
    codexHarness.coldPreflight = originalColdPreflight
    codexHarness.coldRetirementPreflight = originalColdRetirementPreflight
    codexHarness.cleanupRuntime = originalCleanup
    if (leaf?.pid && processStartToken(leaf.pid)) {
      try { process.kill(leaf.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('public close cancels a clean never-launched queue without entering the unrelated shared-runtime guard', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const originalShared = codexHarness.sharedRuntimes
  const originalCleanup = codexHarness.cleanupRuntime
  const home = mkdtempSync(join(tmpdir(), 'spex-queued-close-'))
  const main = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' }).split('\n')
    .find((line) => line.startsWith('worktree '))!.slice('worktree '.length)
  const branches: string[] = []
  const paths: string[] = []
  process.env.SPEXCODE_HOME = home

  const prepare = (suffix: string, thread = '') => {
    const id = `queued-close-${suffix}-${process.pid}`
    const branch = `test/queued-close-${suffix}-${process.pid}-${Date.now()}`
    const path = join(home, `${suffix}-worktree`)
    execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '-b', branch, path, 'main'])
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
    key: 'codex-app-server', label: 'Codex app-server', pidFile: join(home, 'shared.pid'), isolationFile: join(home, 'shared.scope'),
    residency: async () => ({ healthy: true, referenceIds: ['unrelated-unowned-a', 'unrelated-unowned-b'] }),
    probe: async () => { throw new Error('never-launched queue close must not enter the shared-runtime guard') },
  }]
  codexHarness.cleanupRuntime = async () => { throw new Error('never-launched queue close must not invoke adapter cleanup') }

  try {
    const clean = prepare('clean')
    assert.equal(await closeSession(clean.id), true)
    assert.equal(existsSync(clean.path), false, 'queue close removes the prepared worktree')
    assert.equal(existsSync(sessionStoreDir(clean.id)), false, 'queue close removes record and prepared prompt')
    assert.equal(execFileSync('git', ['-C', main, 'branch', '--list', clean.branch], { encoding: 'utf8' }).trim(), '', 'queue close removes the prepared branch')

    const dirty = prepare('dirty')
    writeFileSync(join(dirty.path, 'uncommitted.txt'), 'owned work\n')
    await assert.rejects(closeSession(dirty.id), /prepared worktree has dirty work/)
    assert.equal(existsSync(sessionRecordPath(dirty.id)), true, 'dirty-work ambiguity preserves the queued record')
    assert.equal(existsSync(dirty.path), true, 'dirty-work ambiguity preserves the worktree')

    const threaded = prepare('threaded', `unexpected-thread-${process.pid}`)
    await assert.rejects(closeSession(threaded.id), /record has a target thread or is no longer queued/)
    assert.equal(existsSync(sessionRecordPath(threaded.id)), true, 'thread ambiguity preserves the queued record')

    const pidArtifact = prepare('pid-artifact')
    writeFileSync(sessionArtifactPath(pidArtifact.id, 'agent.pid'), 'not-a-pid\n')
    await assert.rejects(closeSession(pidArtifact.id), /target leaf PID artifact is unreadable/)
    assert.equal(existsSync(sessionRecordPath(pidArtifact.id)), true, 'unreadable PID ambiguity preserves the queued record')

    const ahead = prepare('ahead')
    execFileSync('git', ['-c', 'user.name=Queue Close Fixture', '-c', 'user.email=queue-close@example.test', '-C', ahead.path, 'commit', '--allow-empty', '-q', '-m', 'fixture: owned queue work'])
    await assert.rejects(closeSession(ahead.id), /prepared branch is 1 commit\(s\) ahead/)
    assert.equal(existsSync(sessionRecordPath(ahead.id)), true, 'ahead-work ambiguity preserves the queued record')

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

    const deletionFailure = prepare('deletion-failure')
    chmodSync(sessionStoreDir(deletionFailure.id), 0o500)
    try {
      await assert.rejects(closeSession(deletionFailure.id), /session record\/prompt removal failed/)
      assert.equal(existsSync(sessionStoreDir(deletionFailure.id)), true, 'close cannot report success after incomplete store/prompt removal')
    } finally {
      chmodSync(sessionStoreDir(deletionFailure.id), 0o700)
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
    assert.match(script, /SPEXCODE_SESSION_IDENTITY_VARS=/)
    assert.ok(sessionIdentityEnvVars().includes('SPEXCODE_SESSION_ID'))
  } finally {
    if (prevHome === undefined) delete process.env.SPEXCODE_HOME; else process.env.SPEXCODE_HOME = prevHome
  }
})

test('the spawner pointer names the parent worktree and stays quiet without one', () => {
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
