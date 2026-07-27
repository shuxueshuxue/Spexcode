import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const spexBin = fileURLToPath(new URL('../bin/spex.mjs', import.meta.url))
const apiEntry = fileURLToPath(new URL('./index.ts', import.meta.url))
const dispatch = fileURLToPath(new URL('../hooks/dispatch.sh', import.meta.url))
const httpFixture = fileURLToPath(new URL('../test/session-maintenance-http-fixture.mjs', import.meta.url))
const tsx = join(pkgRoot, 'node_modules', '.bin', 'tsx')
const home = mkdtempSync(join(tmpdir(), 'spex-maintenance-seams-a-'))
const transportBin = join(home, 'bin')
const tmuxCalls = join(home, 'tmux-calls')
const terminalInput = join(home, 'terminal-input')
const terminalAttached = join(home, 'terminal-attached')
mkdirSync(transportBin, { recursive: true })
writeFileSync(join(transportBin, 'tmux'), `#!/usr/bin/env bash
printf '%s\n' "$*" >> ${JSON.stringify(tmuxCalls)}
case "$*" in
  *attach-session*) touch ${JSON.stringify(terminalAttached)}; cat >> ${JSON.stringify(terminalInput)} ;;
  *display-message*) printf '/dev/pts/fixture\n' ;;
esac
exit 0
`)
chmodSync(join(transportBin, 'tmux'), 0o755)
process.env.SPEXCODE_HOME = home
process.env.SPEXCODE_TMUX = `spex-maintenance-a-${process.pid}`
process.env.PATH = `${transportBin}:${process.env.PATH}`
after(() => rmSync(home, { recursive: true, force: true }))

const TOKEN = '71'.repeat(32)
const DELEGATE = '72'.repeat(32)
const ID = 'a1111111-1111-4111-8111-111111111111'
const RESUME_ONE = 'b2222222-2222-4222-8222-222222222222'
const RESUME_FORCE = 'c3333333-3333-4333-8333-333333333333'
const OTHER = 'd4444444-4444-4444-8444-444444444444'
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as any
const lines = (path: string) => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : []

function leaseRow(state: 'open' | 'active', pid: number, startToken: string, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    state,
    epoch: 41,
    tokenHash: state === 'active' ? createHash('sha256').update(TOKEN).digest('hex') : null,
    owner: state === 'active' ? { instanceId: 'maintenance-fixture-generation', pid, startToken } : null,
    heartbeatDeadline: state === 'active' ? Date.now() + 60_000 : null,
    capabilities: state === 'active' ? [{ capability: { op: 'stop', sessionId: ID }, state: 'unused' }] : [],
    tickets: [],
    ...extra,
  }
}

function sessionRow(id: string, worktree: string) {
  return {
    session_id: id, governed: true, worktree_path: worktree, branch: `node/maintenance-${id.slice(0, 4)}`,
    node: '', title: 'maintenance fixture', name: '', parent: '', status: 'active', proposal: '', merges: 0,
    note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
    archived: false, cold_proof: '', adapter_recovery: '', launcher: 'claude', launch_cmd: '', launch_owner: '',
  }
}

function publicRow(id = ID) {
  return {
    id, node: null, branch: `node/${id.slice(0, 4)}`, path: `/tmp/${id}`, label: id, headline: id,
    raw: { name: null, title: null }, parent: null, harness: 'claude', capabilities: { headless: false },
    launcher: 'claude', lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online',
    note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
  }
}

async function capture(run: () => unknown | Promise<unknown>) {
  try {
    const value = await run() as any
    return { code: value?.code ?? null, value }
  } catch (error: any) {
    return { code: error?.code ?? null, value: null }
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string, attempts = 300): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return
    await sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function collect(child: ChildProcess) {
  let stdout = ''; let stderr = ''
  child.stdout?.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr?.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const closed = once(child, 'close') as Promise<[number]>
  return async () => {
    const [code] = await closed
    return { code, stdout, stderr }
  }
}

test('actual create/send/raw-key/xterm/hook-state/queue/sort seams refuse active maintenance before transport or durable effects', async () => {
  const [{ runtimeRoot, sessionRecordPath }, { processStartToken }, sessions, pty] = await Promise.all([
    import('./layout.js'), import('./process-identity.js'), import('./sessions.js'), import('./pty-bridge.js'),
  ])
  const root = runtimeRoot()
  const leasePath = join(root, 'session-maintenance.json')
  const worktree = mkdtempSync(join(tmpdir(), 'spex-maintenance-record-a-'))
  const recordPath = sessionRecordPath(ID)
  mkdirSync(dirname(recordPath), { recursive: true })
  writeFileSync(recordPath, JSON.stringify(sessionRow(ID, worktree), null, 2))
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  writeFileSync(leasePath, JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const leaseBefore = readFileSync(leasePath, 'utf8')
  const recordBefore = readFileSync(recordPath, 'utf8')
  let createEffects = 0

  const viewer = { send() {} }
  pty.attachViewer(ID, viewer)
  pty.resizeBridge(ID, viewer, 80, 24)
  await waitFor(() => existsSync(terminalAttached), 'real terminal subscription')
  await waitFor(() => lines(tmuxCalls).some((line) => line.includes('list-clients')), 'terminal subscription setup transport')
  writeFileSync(tmuxCalls, '')
  writeFileSync(terminalInput, '')

  const create = await capture(() => sessions.sessionCreateRequest({ prompt: 'blocked create', parent: null }, async () => {
    createEffects++
    return { id: 'must-not-exist' } as any
  }))
  const send = await capture(() => sessions.sendText(ID, 'blocked send'))
  const rawKey = await capture(() => sessions.rawKey(ID, 'Enter'))
  const terminal = await capture(() => pty.forwardInput(ID, viewer, 'X\n'))
  await sleep(50)
  const hookState = await capture(() => sessions.markState('parked', { sessionId: ID, note: 'must-not-land' }))
  const queue = await capture(() => sessions.drainQueue())
  const sort = await capture(() => sessions.setSessionSort(ID, 1234))
  const tmuxTransports = lines(tmuxCalls)
  const terminalWrites = existsSync(terminalInput) ? readFileSync(terminalInput, 'utf8').length : 0
  pty.detachViewer(ID, viewer)

  const actual = {
    codes: [create.code, send.code, rawKey.code, terminal.code, hookState.code, queue.code, sort.code],
    createEffects, tmuxTransports, terminalWrites,
    leaseUnchanged: readFileSync(leasePath, 'utf8') === leaseBefore,
    recordUnchanged: readFileSync(recordPath, 'utf8') === recordBefore,
  }
  rmSync(worktree, { recursive: true, force: true })
  assert.deepEqual(actual, {
    codes: Array(7).fill('maintenance_active'), createEffects: 0, tmuxTransports: [], terminalWrites: 0,
    leaseUnchanged: true, recordUnchanged: true,
  })
})

test('real no-backend fallback refuses before launcher, tmux, record, worktree, or branch effects', async () => {
  const { processStartToken } = await import('./process-identity.js')
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-fallback-a-'))
  const projectPath = join(dir, 'project'); mkdirSync(projectPath, { recursive: true })
  const project = realpathSync(projectPath)
  const fallbackHome = join(dir, 'home')
  const runtime = join(fallbackHome, 'projects', project.replace(/[/.]/g, '-'))
  const bin = join(dir, 'bin'); mkdirSync(bin)
  const tmuxLog = join(dir, 'tmux.log'); const launcherLog = join(dir, 'launcher.log')
  const launcher = join(bin, 'fake-launcher')
  writeFileSync(join(bin, 'tmux'), `#!/usr/bin/env bash\nprintf '%s\n' "$*" >> ${JSON.stringify(tmuxLog)}\nexit 0\n`)
  writeFileSync(launcher, `#!/usr/bin/env bash\ntouch ${JSON.stringify(launcherLog)}\nexit 0\n`)
  chmodSync(join(bin, 'tmux'), 0o755); chmodSync(launcher, 0o755)
  mkdirSync(join(project, '.spec'), { recursive: true })
  cpSync(join(pkgRoot, 'templates', 'spec', 'project'), join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: launcher } }, defaultLauncher: 'fake' },
  }, null, 2))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  mkdirSync(runtime, { recursive: true })
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  writeFileSync(join(runtime, 'session-maintenance.json'), JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const child = spawn(tsx, [cli, 'session', 'new', 'fallback must be blocked', '--launcher', 'fake', '--api', 'http://127.0.0.1:1'], {
    cwd: project,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPEXCODE_HOME: fallbackHome, SPEXCODE_TMUX: `fallback-${process.pid}`, SPEXCODE_API_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const childDone = collect(child)
  await waitFor(() => child.exitCode !== null || lines(tmuxLog).length > 0 || existsSync(join(runtime, 'sessions')), 'fallback refusal or first side effect')
  const exitedBeforeProbe = child.exitCode !== null
  if (!exitedBeforeProbe) child.kill('SIGTERM')
  const result = await childDone()
  const actual = {
    status: result.code,
    exitedBeforeProbe,
    structured: /maintenance_active/.test(result.stdout + result.stderr),
    launcherCalls: lines(launcherLog).length,
    tmuxCalls: lines(tmuxLog).length,
    sessionDirs: existsSync(join(runtime, 'sessions')) ? readdirSync(join(runtime, 'sessions')).length : 0,
    worktreeCount: existsSync(join(project, '.worktrees')) ? readdirSync(join(project, '.worktrees')).length : 0,
    branchCount: execFileSync('git', ['branch', '--list', 'node/*'], { cwd: project, encoding: 'utf8' }).trim() ? 1 : 0,
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 1, exitedBeforeProbe: true, structured: true, launcherCalls: 0, tmuxCalls: 0, sessionDirs: 0, worktreeCount: 0, branchCount: 0 })
})

test('real dispatcher holds one open ticket for the whole handler run and active maintenance invokes zero handlers', async () => {
  const { processStartToken } = await import('./process-identity.js')
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-hook-a-'))
  const hookHome = join(dir, 'home')
  const runtime = join(hookHome, 'projects', dir.replace(/[/.]/g, '-'))
  const entered = join(dir, 'entered'); const completed = join(dir, 'completed'); const release = join(dir, 'release')
  const manifest = join(dir, 'hooks-manifest'); const script = join(dir, 'handler.sh')
  spawnSync('git', ['init', '-q'], { cwd: dir }); mkdirSync(runtime, { recursive: true })
  writeFileSync(script, `#!/usr/bin/env bash\ntouch ${JSON.stringify(entered)}\nwhile [ ! -f ${JSON.stringify(release)} ]; do sleep 0.02; done\ntouch ${JSON.stringify(completed)}\n`)
  writeFileSync(manifest, `PreToolUse\t10\ttrue\t${script.slice(dir.length + 1)}\n`)
  const env = { ...process.env, SPEXCODE_HOME: hookHome, SPEX_HOOK_MANIFEST: manifest, SPEX: join(repoRoot, 'spec-cli', 'bin', 'spex.mjs') }
  const payload = JSON.stringify({ session_id: ID, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } })

  writeFileSync(join(runtime, 'session-maintenance.json'), JSON.stringify(leaseRow('open', process.pid, ''), null, 2))
  const open = spawn('bash', [dispatch, 'claude', 'PreToolUse'], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] })
  open.stdin.end(payload)
  const openDone = collect(open)
  await waitFor(() => existsSync(entered), 'open handler entry')
  const openTicketDuring = json(join(runtime, 'session-maintenance.json')).tickets.some((ticket: any) => ticket.operation === 'hook-state')
  writeFileSync(release, '')
  const openResult = await openDone()
  const openTicketAfter = json(join(runtime, 'session-maintenance.json')).tickets.some((ticket: any) => ticket.operation === 'hook-state')
  const openCompleted = existsSync(completed)

  rmSync(entered, { force: true }); rmSync(completed, { force: true })
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  writeFileSync(join(runtime, 'session-maintenance.json'), JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const activeBefore = readFileSync(join(runtime, 'session-maintenance.json'), 'utf8')
  const active = spawnSync('bash', [dispatch, 'claude', 'PreToolUse'], { cwd: dir, env, input: payload, encoding: 'utf8' })
  const actual = {
    openStatus: openResult.code, openCompleted, openTicketDuring, openTicketAfter,
    activeStatus: active.status, activeStructured: /maintenance_active/.test(active.stdout + active.stderr),
    activeHandlerRan: existsSync(entered), activeDurableUnchanged: readFileSync(join(runtime, 'session-maintenance.json'), 'utf8') === activeBefore,
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, {
    openStatus: 0, openCompleted: true, openTicketDuring: true, openTicketAfter: false,
    activeStatus: 2, activeStructured: true, activeHandlerRan: false, activeDurableUnchanged: true,
  })
})

test('real internal shared spawn admits one valid delegate and refuses forged, replayed, or absent delegates with complete artifact snapshots', async () => {
  const [{ runtimeRoot }, { processStartToken }] = await Promise.all([import('./layout.js'), import('./process-identity.js')])
  const root = runtimeRoot(); const leasePath = join(root, 'session-maintenance.json')
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  const activeResume = () => leaseRow('active', process.pid, startToken, {
    capabilities: [{ capability: { op: 'resume', sessionId: ID, force: true }, state: 'inflight', requestId: 'resume-ticket' }],
    tickets: [{ id: 'resume-ticket', epoch: 41, operation: 'resume', sessionId: ID, force: true, owner: { pid: process.pid, startToken }, deadline: Date.now() + 60_000, mode: 'maintenance' }],
    delegates: [{ tokenHash: createHash('sha256').update(DELEGATE).digest('hex'), parentTicketId: 'resume-ticket', epoch: 41, operation: 'shared-spawn', sessionId: ID, state: 'unused' }],
  })
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-spawn-a-'))

  const run = async (name: string, delegate: string | null) => {
    const runDir = join(dir, name); mkdirSync(runDir)
    const log = join(runDir, 'runtime.log'); const pidFile = join(runDir, 'runtime.pid'); const scope = join(runDir, 'runtime.scope')
    const child = spawn(process.execPath, [spexBin, 'internal', 'shared-runtime-spawn', runDir, log, pidFile, scope, process.execPath, '-e', 'console.log("SPAWN-READY"); setInterval(() => {}, 1000)'], {
      cwd: pkgRoot,
      env: { ...process.env, SPEXCODE_SESSION_ID: ID, SPEXCODE_MAINTENANCE_DELEGATE_FD: '3' },
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    })
    const done = collect(child)
    const delegatePipe = child.stdio[3] as NodeJS.WritableStream
    delegatePipe.on('error', () => {})
    delegatePipe.end(delegate ?? '')
    const result = await done()
    await waitFor(() => result.code !== 0 || existsSync(pidFile), `${name} pid artifact`)
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0
    for (let i = 0; i < 100 && pid > 0 && (!existsSync(log) || !readFileSync(log, 'utf8').includes('SPAWN-READY')); i++) await sleep(10)
    const token = pid > 0 ? processStartToken(pid) : null
    const snapshot = {
      status: result.code,
      structured: /maintenance_active|maintenance_delegate_invalid/.test(result.stdout + result.stderr),
      pidLive: !!token,
      logReady: existsSync(log) && readFileSync(log, 'utf8').includes('SPAWN-READY'),
      scopeExact: !!token && existsSync(scope) && readFileSync(scope, 'utf8') === `detached-v3 ${pid} ${token} ${pid} ${pid}\n`,
      pidArtifact: existsSync(pidFile),
    }
    if (pid > 0 && token && processStartToken(pid) === token) {
      process.kill(pid, 'SIGTERM')
      await waitFor(() => processStartToken(pid) !== token, `${name} exact PID cleanup`)
    }
    return snapshot
  }

  writeFileSync(leasePath, JSON.stringify(activeResume(), null, 2))
  const valid = await run('valid', DELEGATE)
  const replay = await run('replay', DELEGATE)
  writeFileSync(leasePath, JSON.stringify(activeResume(), null, 2))
  const forged = await run('forged', 'ff'.repeat(32))
  writeFileSync(leasePath, JSON.stringify(activeResume(), null, 2))
  const absent = await run('absent', null)
  rmSync(dir, { recursive: true, force: true })

  assert.deepEqual(valid, { status: 0, structured: false, pidLive: true, logReady: true, scopeExact: true, pidArtifact: true })
  for (const refused of [replay, forged, absent]) {
    assert.deepEqual(refused, { status: 1, structured: true, pidLive: false, logReady: false, scopeExact: false, pidArtifact: false })
  }
})

async function startHttpFixture(mode: 'draining-active' | 'expiry' | 'heartbeat-loss' | 'broker-concurrent' | 'broker-transport-loss' | 'broker-pending-transport-loss' | 'resume-refused-retry' | 'post-acquire-validation', resultPath: string, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, [httpFixture], { env: { ...process.env, MODE: mode, RESULT_PATH: resultPath, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = once(child, 'close') as Promise<[number]>
  let stdout = ''; let stderr = ''; let port = 0
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    stdout += chunk
    const match = stdout.match(/READY (\d+)/)
    if (match) port = Number(match[1])
  })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  await waitFor(() => port > 0 || child.exitCode !== null, `${mode} HTTP fixture`)
  assert.ok(port > 0, stderr)
  return {
    child,
    base: `http://127.0.0.1:${port}`,
    output: () => stdout + stderr,
    async stop() { if (child.exitCode === null) child.kill('SIGTERM'); await closed },
  }
}

function events(path: string): any[] {
  return lines(path).map((line) => JSON.parse(line))
}

test('202 wrapper waits without command/broker, then brokers only exact allowlist; expiry never executes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-wrapper-a-'))
  const resultPath = join(dir, 'events.ndjson'); const marker = join(dir, 'command-ran'); const childEnv = join(dir, 'child.env'); const codes = join(dir, 'codes')
  const fixture = await startHttpFixture('draining-active', resultPath)
  const script = join(dir, 'command.sh')
  writeFileSync(script, `#!/usr/bin/env bash
touch ${JSON.stringify(marker)}
env > ${JSON.stringify(childEnv)}
set +e
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session stop ${ID} --api ${JSON.stringify(fixture.base)}; echo "allowed=$?" >> ${JSON.stringify(codes)}
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session stop ${OTHER} --api ${JSON.stringify(fixture.base)}; echo "wrong_session=$?" >> ${JSON.stringify(codes)}
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session send ${ID} nope --api ${JSON.stringify(fixture.base)}; echo "wrong_op=$?" >> ${JSON.stringify(codes)}
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session resume ${RESUME_FORCE} --api ${JSON.stringify(fixture.base)}; echo "wrong_force=$?" >> ${JSON.stringify(codes)}
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session new 'broker-blocked-create' --api ${JSON.stringify(fixture.base)}; echo "create=$?" >> ${JSON.stringify(codes)}
exit 0
`)
  chmodSync(script, 0o755)
  const wrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--allow-resume', RESUME_ONE, '--allow-resume', `${RESUME_FORCE}:force`, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', script], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const wrapperDone = collect(wrapper)
  await waitFor(() => wrapper.exitCode !== null || events(resultPath).some((event) => event.step === 'status' && event.state === 'draining'), '202 draining status or wrapper refusal')
  const executedWhileDraining = existsSync(marker)
  const brokeredWhileDraining = events(resultPath).some((event) => event.step === 'operation')
  const result = await wrapperDone()
  const activeEvents = events(resultPath)
  await fixture.stop()
  const acquire = activeEvents.find((event) => event.step === 'acquire')
  const activeAt = activeEvents.find((event) => event.step === 'status' && event.state === 'active')?.at ?? Infinity
  const operationEvents = activeEvents.filter((event) => event.step === 'operation')
  const heartbeatEvents = activeEvents.filter((event) => event.step === 'heartbeat')
  const releaseEvent = activeEvents.find((event) => event.step === 'release')
  const codeRows = Object.fromEntries(lines(codes).map((line) => line.split('=')))
  const envText = existsSync(childEnv) ? readFileSync(childEnv, 'utf8') : ''
  const markerAt = existsSync(marker) ? statSync(marker).mtimeMs : 0

  const expiryEvents = join(dir, 'expiry.ndjson'); const expiryMarker = join(dir, 'expiry-ran')
  const expiry = await startHttpFixture('expiry', expiryEvents)
  const expiredWrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--ttl-ms', '5000', '--wait-ms', '0', '--api', expiry.base, '--', 'bash', '-c', `touch ${JSON.stringify(expiryMarker)}`], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const expired = await collect(expiredWrapper)()
  await expiry.stop()

  const actual = {
    status: result.code, executedWhileDraining, brokeredWhileDraining,
    acquireCapabilities: acquire?.input?.capabilities,
    acquireTtl: acquire?.input?.ttlMs, acquireWait: acquire?.input?.waitMs,
    heartbeatObserved: heartbeatEvents.length > 0,
    heartbeatBeforeActive: heartbeatEvents.some((event) => event.at <= activeAt),
    heartbeatBearerExact: heartbeatEvents.every((event) => event.header === TOKEN),
    heartbeatBodyExact: heartbeatEvents.every((event) => JSON.stringify(event.input) === JSON.stringify({ epoch: 7, ttlMs: 5_000 })),
    commandAfterActive: markerAt >= activeAt,
    forwarded: operationEvents.map((event) => ({ op: event.op, sessionId: event.sessionId, header: event.header })),
    codes: codeRows,
    tokenInOutput: (result.stdout + result.stderr + fixture.output()).includes(TOKEN),
    tokenInEnv: envText.includes(TOKEN), brokerFds: /SPEXCODE_MAINTENANCE_BROKER_FDS=/.test(envText),
    release: releaseEvent ? { header: releaseEvent.header, input: releaseEvent.input } : null,
    expiryStatus: expired.code, expiryExecuted: existsSync(expiryMarker), expiryForwarded: events(expiryEvents).some((event) => event.step === 'operation'),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, {
    status: 0, executedWhileDraining: false, brokeredWhileDraining: false,
    acquireCapabilities: [
      { op: 'stop', sessionId: ID }, { op: 'resume', sessionId: RESUME_ONE, force: false }, { op: 'resume', sessionId: RESUME_FORCE, force: true },
    ],
    acquireTtl: 5000, acquireWait: 0,
    heartbeatObserved: true, heartbeatBeforeActive: true, heartbeatBearerExact: true, heartbeatBodyExact: true,
    commandAfterActive: true,
    forwarded: [{ op: 'stop', sessionId: ID, header: TOKEN }],
    codes: { allowed: '0', wrong_session: '1', wrong_op: '1', wrong_force: '1', create: '1' },
    tokenInOutput: false, tokenInEnv: false, brokerFds: true,
    release: { header: TOKEN, input: { epoch: 7 } },
    expiryStatus: 1, expiryExecuted: false, expiryForwarded: false,
  })
})

test('active heartbeat loss closes broker admission and terminates the operator command before it can continue', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-heartbeat-loss-a-'))
  const resultPath = join(dir, 'events.ndjson'); const entered = join(dir, 'entered'); const terminated = join(dir, 'terminated'); const completed = join(dir, 'completed')
  const fixture = await startHttpFixture('heartbeat-loss', resultPath)
  const script = join(dir, 'operator.sh')
  writeFileSync(script, `#!/usr/bin/env bash
trap 'touch ${JSON.stringify(terminated)}; exit 73' TERM
touch ${JSON.stringify(entered)}
sleep 3
touch ${JSON.stringify(completed)}
`)
  chmodSync(script, 0o755)
  const started = Date.now()
  const wrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', script], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = await collect(wrapper)()
  const elapsed = Date.now() - started
  await fixture.stop()
  const actual = {
    status: result.code,
    entered: existsSync(entered),
    heartbeatFailed: events(resultPath).some((event) => event.step === 'heartbeat'),
    terminated: existsSync(terminated),
    completed: existsSync(completed),
    bounded: elapsed < 2_500,
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 1, entered: true, heartbeatFailed: true, terminated: true, completed: false, bounded: true })
})

test('live broker transport loss closes admission and terminates the operator command', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-broker-loss-a-'))
  const resultPath = join(dir, 'events.ndjson'); const entered = join(dir, 'entered'); const terminated = join(dir, 'terminated'); const completed = join(dir, 'completed')
  const fixture = await startHttpFixture('broker-transport-loss', resultPath)
  const script = join(dir, 'operator.sh')
  writeFileSync(script, `#!/usr/bin/env bash
trap 'touch ${JSON.stringify(terminated)}; exit 74' TERM
touch ${JSON.stringify(entered)}
exec 5>&-
sleep 3
touch ${JSON.stringify(completed)}
`)
  chmodSync(script, 0o755)
  const started = Date.now()
  const wrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', script], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = await collect(wrapper)()
  const elapsed = Date.now() - started
  await fixture.stop()
  const actual = {
    status: result.code,
    entered: existsSync(entered),
    terminated: existsSync(terminated),
    completed: existsSync(completed),
    bounded: elapsed < 2_500,
    released: events(resultPath).some((event) => event.step === 'release'),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 1, entered: true, terminated: true, completed: false, bounded: true, released: false })
})

test('live broker transport loss aborts a pending HTTP operation before bounded wrapper exit', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-broker-pending-loss-a-'))
  const resultPath = join(dir, 'events.ndjson'); const entered = join(dir, 'entered'); const terminated = join(dir, 'terminated'); const completed = join(dir, 'completed')
  const fixture = await startHttpFixture('broker-pending-transport-loss', resultPath)
  const script = join(dir, 'operator.sh')
  writeFileSync(script, `#!/usr/bin/env bash
trap 'touch ${JSON.stringify(terminated)}; exit 75' TERM
touch ${JSON.stringify(entered)}
${JSON.stringify(process.execPath)} --import tsx ${JSON.stringify(cli)} session stop ${ID} --api ${JSON.stringify(fixture.base)} & request=$!
while ! grep -q '"step":"operation"' ${JSON.stringify(resultPath)}; do sleep 0.01; done
exec 3>&- 4>&- 5>&-
kill "$request" 2>/dev/null || true
sleep 3
touch ${JSON.stringify(completed)}
`)
  chmodSync(script, 0o755)
  const started = Date.now()
  const wrapper = spawn(process.execPath, ['--import', 'tsx', cli, 'session', 'maintain', '--allow-stop', ID, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', script], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const done = collect(wrapper)
  let result: Awaited<ReturnType<typeof done>> | null = null
  try {
    result = await Promise.race([done(), sleep(2_500).then(() => null)])
  } finally {
    if (wrapper.exitCode === null) {
      wrapper.kill('SIGKILL')
      await once(wrapper, 'close')
    }
    await fixture.stop()
  }
  const actual = {
    status: result?.code ?? null,
    entered: existsSync(entered),
    requestReachedBackend: events(resultPath).some((event) => event.step === 'operation'),
    terminated: existsSync(terminated),
    completed: existsSync(completed),
    bounded: result !== null && Date.now() - started < 2_500,
    released: events(resultPath).some((event) => event.step === 'release'),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, {
    status: 1, entered: true, requestReachedBackend: true, terminated: true,
    completed: false, bounded: true, released: false,
  })
})

test('post-acquire validation failure safely releases the exact lease before command spawn', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-post-acquire-cleanup-a-'))
  const resultPath = join(dir, 'events.ndjson'); const marker = join(dir, 'command-ran')
  const fixture = await startHttpFixture('post-acquire-validation', resultPath)
  const wrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', 'bash', '-c', `touch ${JSON.stringify(marker)}`], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = await collect(wrapper)()
  const status = await fetch(`${fixture.base}/api/session-maintenance`).then((response) => response.json()) as any
  await fixture.stop()
  const release = events(resultPath).find((event) => event.step === 'release')
  const actual = {
    status: result.code,
    commandRan: existsSync(marker),
    operations: events(resultPath).filter((event) => event.step === 'operation').length,
    release: release ? { header: release.header, input: release.input } : null,
    final: { state: status.state, owner: status.owner, capabilities: status.capabilities },
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, {
    status: 1, commandRan: false, operations: 0,
    release: { header: TOKEN, input: { epoch: 7 } },
    final: { state: 'open', owner: null, capabilities: [] },
  })
})

test('concurrent nested stop and resume receive only their own broker responses', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-broker-concurrent-a-'))
  const resultPath = join(dir, 'events.ndjson'); const release = join(dir, 'release'); const codes = join(dir, 'codes')
  const fixture = await startHttpFixture('broker-concurrent', resultPath, { BROKER_RELEASE_PATH: release })
  const script = join(dir, 'operator.sh')
  writeFileSync(script, `#!/usr/bin/env bash
set +e
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session stop ${ID} --api ${JSON.stringify(fixture.base)} & first=$!
while ! grep -q '"step":"operation".*"op":"stop"' ${JSON.stringify(resultPath)}; do sleep 0.01; done
kill -STOP "$first"
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session resume ${RESUME_ONE} --api ${JSON.stringify(fixture.base)} & second=$!
for _ in $(seq 1 300); do grep -q 'pipe_read' "/proc/$second/wchan" 2>/dev/null && break; sleep 0.01; done
touch ${JSON.stringify(release)}
wait "$second"; second_rc=$?
kill -CONT "$first" 2>/dev/null
wait "$first"; first_rc=$?
printf 'first=%s\nsecond=%s\n' "$first_rc" "$second_rc" > ${JSON.stringify(codes)}
exit 0
`)
  chmodSync(script, 0o755)
  const wrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--allow-resume', RESUME_ONE, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', script], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = await collect(wrapper)()
  await fixture.stop()
  const codeRows = Object.fromEntries(lines(codes).map((line) => line.split('=')))
  const actual = {
    wrapper: result.code,
    codes: codeRows,
    operations: events(resultPath).filter((event) => event.step === 'operation').map((event) => `${event.op}:${event.sessionId}`),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { wrapper: 0, codes: { first: '0', second: '0' }, operations: [`stop:${ID}`, `resume:${RESUME_ONE}`] })
})

test('HTTP resume refusal leaves the exact broker capability retryable until a completed attempt', { timeout: 15_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-resume-retry-a-'))
  const resultPath = join(dir, 'events.ndjson'); const codes = join(dir, 'codes')
  const fixture = await startHttpFixture('resume-refused-retry', resultPath)
  const script = join(dir, 'operator.sh')
  writeFileSync(script, `#!/usr/bin/env bash
set +e
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session resume ${RESUME_ONE} --api ${JSON.stringify(fixture.base)}; first=$?
${JSON.stringify(process.execPath)} ${JSON.stringify(spexBin)} session resume ${RESUME_ONE} --api ${JSON.stringify(fixture.base)}; second=$?
printf 'first=%s\nsecond=%s\n' "$first" "$second" > ${JSON.stringify(codes)}
exit 0
`)
  chmodSync(script, 0o755)
  const wrapper = spawn(tsx, [cli, 'session', 'maintain', '--allow-resume', RESUME_ONE, '--ttl-ms', '5000', '--wait-ms', '0', '--api', fixture.base, '--', script], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const result = await collect(wrapper)()
  await fixture.stop()
  const actual = {
    wrapper: result.code,
    codes: Object.fromEntries(lines(codes).map((line) => line.split('='))),
    operations: events(resultPath).filter((event) => event.step === 'operation' && event.op === 'resume').length,
    released: events(resultPath).some((event) => event.step === 'release'),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { wrapper: 0, codes: { first: '1', second: '0' }, operations: 2, released: true })
})

test('actual session attach is refused before tmux while active and holds an open ticket for its foreground lifetime', async () => {
  const { processStartToken } = await import('./process-identity.js')
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-attach-a-'))
  const commonDir = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  const attachHome = join(dir, 'home'); const runtime = join(attachHome, 'projects', dirname(commonDir).replace(/[/.]/g, '-')); const leasePath = join(runtime, 'session-maintenance.json')
  const bin = join(dir, 'bin'); const attached = join(dir, 'attached'); const release = join(dir, 'release'); const tty = join(dir, 'tty.cjs'); const calls = join(dir, 'tmux.calls')
  mkdirSync(runtime, { recursive: true }); mkdirSync(bin)
  writeFileSync(tty, "Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});\n")
  writeFileSync(join(bin, 'tmux'), `#!/usr/bin/env bash\nprintf '%s\n' "$*" >> ${JSON.stringify(calls)}\ncase "$*" in *attach-session*) touch ${JSON.stringify(attached)}; while [ ! -f ${JSON.stringify(release)} ]; do sleep 0.02; done;; esac\nexit 0\n`)
  chmodSync(join(bin, 'tmux'), 0o755)
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') return res.end(JSON.stringify([publicRow()]))
    res.statusCode = 404; res.end('{}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const env = { ...process.env, SPEXCODE_HOME: attachHome, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--require=${tty}` }
  const args = [cli, 'session', 'attach', ID, '--api', `http://127.0.0.1:${address.port}`]

  writeFileSync(leasePath, JSON.stringify(leaseRow('open', process.pid, ''), null, 2))
  const open = spawn(tsx, args, { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] }); const openDone = collect(open)
  await waitFor(() => existsSync(attached), 'open attach')
  const ticketDuring = json(leasePath).tickets.some((ticket: any) => ticket.operation === 'attach' && ticket.sessionId === ID)
  writeFileSync(release, '')
  const openResult = await openDone()
  const ticketAfter = json(leasePath).tickets.some((ticket: any) => ticket.operation === 'attach')

  writeFileSync(calls, ''); rmSync(attached, { force: true })
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  writeFileSync(leasePath, JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const activeChild = spawn(tsx, args, { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const active = await collect(activeChild)()
  const actual = {
    openStatus: openResult.code, ticketDuring, ticketAfter,
    activeStatus: active.code, activeStructured: /maintenance_active/.test(active.stdout + active.stderr), activeTmuxCalls: lines(calls).length,
  }
  server.close(); await once(server, 'close'); rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { openStatus: 0, ticketDuring: true, ticketAfter: false, activeStatus: 1, activeStructured: true, activeTmuxCalls: 0 })
})

async function freePort(): Promise<number> {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  server.close(); await once(server, 'close'); return address.port
}

test('active lease authority survives backend child replacement without reopening ordinary writes', { timeout: 60_000 }, async () => {
  const { processStartToken } = await import('./process-identity.js')
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-hot-reload-a-'))
  const projectPath = join(dir, 'project'); mkdirSync(projectPath); const project = realpathSync(projectPath)
  const apiHome = join(dir, 'home'); const runtime = join(apiHome, 'projects', project.replace(/[/.]/g, '-'))
  const instanceId = 'maintenance-hot-reload-generation'
  const portA = await freePort(); const portB = await freePort()
  const authorityStart = processStartToken(process.pid); assert.ok(authorityStart)
  mkdirSync(join(project, '.spec'), { recursive: true })
  cpSync(join(pkgRoot, 'templates', 'spec', 'project'), join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }, null, 2))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  mkdirSync(join(runtime, 'backend-instances'), { recursive: true })
  writeFileSync(join(runtime, 'backend-instances', `${instanceId}.json`), JSON.stringify({
    version: 1, instanceId, pid: process.pid, startToken: authorityStart, projectRoot: project, startedAt: new Date().toISOString(),
  }))
  const env = {
    ...process.env,
    PATH: process.env.PATH?.split(':').filter((part) => part !== transportBin).join(':'),
    SPEXCODE_HOME: apiHome,
    SPEXCODE_TMUX: `spex-maintenance-reload-${process.pid}`,
    SPEXCODE_INSTANCE_ID: instanceId,
  }
  const boot = async (port: number) => {
    const child = spawn(tsx, [apiEntry], { cwd: project, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
    const done = collect(child)
    const base = `http://127.0.0.1:${port}`
    await waitFor(async () => { try { return (await fetch(`${base}/health`)).ok } catch { return false } }, `backend ${port} health`, 3000)
    return { child, done, base }
  }
  let first: Awaited<ReturnType<typeof boot>> | null = null
  let second: Awaited<ReturnType<typeof boot>> | null = null
  try {
    first = await boot(portA)
    const acquired = await fetch(`${first.base}/api/session-maintenance/acquire`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: [], ttlMs: 30_000, waitMs: 0 }),
    })
    const lease = await acquired.json() as any
    assert.equal(acquired.status, 201)
    first.child.kill('SIGTERM'); await first.done(); first = null
    second = await boot(portB)
    const status = await fetch(`${second.base}/api/session-maintenance`).then((response) => response.json()) as any
    const heartbeat = await fetch(`${second.base}/api/session-maintenance/heartbeat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-spexcode-session-maintenance': lease.token },
      body: JSON.stringify({ epoch: lease.epoch, ttlMs: 30_000 }),
    })
    const ordinary = await fetch(`${second.base}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'must stay blocked', parent: null }),
    })
    const ordinaryBody = await ordinary.json().catch(() => ({})) as any
    assert.deepEqual({ state: status.state, epoch: status.epoch, heartbeat: heartbeat.status, ordinary: ordinary.status, code: ordinaryBody.code }, {
      state: 'active', epoch: lease.epoch, heartbeat: 200, ordinary: 409, code: 'maintenance_active',
    })
    const released = await fetch(`${second.base}/api/session-maintenance/release`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-spexcode-session-maintenance': lease.token }, body: JSON.stringify({ epoch: lease.epoch }),
    })
    assert.equal(released.status, 200)
  } finally {
    if (first) { first.child.kill('SIGTERM'); await first.done() }
    if (second) { second.child.kill('SIGTERM'); await second.done() }
    rmSync(dir, { recursive: true, force: true })
  }
})

test('real isolated backend admits exact stop plus two resumes under one active capability plan', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-backend-a-'))
  const projectPath = join(dir, 'project'); mkdirSync(projectPath); const project = realpathSync(projectPath)
  const apiHome = join(dir, 'home'); const tmux = `spex-maintenance-backend-${process.pid}-${Date.now()}`; const port = await freePort()
  const runtime = join(apiHome, 'projects', project.replace(/[/.]/g, '-'))
  const instanceId = 'maintenance-backend-generation'
  mkdirSync(join(project, '.spec'), { recursive: true })
  cpSync(join(pkgRoot, 'templates', 'spec', 'project'), join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: join(pkgRoot, 'test', 'fixtures', 'fake-claude') } }, defaultLauncher: 'fake', maxActive: 8 },
  }, null, 2))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  const authorityStart = (await import('./process-identity.js')).processStartToken(process.pid); assert.ok(authorityStart)
  mkdirSync(join(runtime, 'backend-instances'), { recursive: true })
  writeFileSync(join(runtime, 'backend-instances', `${instanceId}.json`), JSON.stringify({
    version: 1, instanceId, pid: process.pid, startToken: authorityStart, projectRoot: project, startedAt: new Date().toISOString(),
  }))
  const child = spawn(tsx, [apiEntry], { cwd: project, env: { ...process.env, PATH: process.env.PATH?.split(':').filter((part) => part !== transportBin).join(':'), PORT: String(port), SPEXCODE_HOME: apiHome, SPEXCODE_TMUX: tmux, SPEXCODE_INSTANCE_ID: instanceId, FAKE_HARNESS_INTERVAL_MS: '50' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const backendDone = collect(child); const base = `http://127.0.0.1:${port}`
  await waitFor(async () => {
    try { return (await fetch(`${base}/health`)).ok } catch { return false }
  }, 'isolated backend health', 3000)
  let token = ''; let actual: any
  try {
    const created = [] as any[]
    for (const prompt of ['stop target', 'resume one', 'resume two', 'wrong-session control']) {
      const response = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, parent: null, launcher: 'fake' }) })
      created.push(await response.json())
    }
    await waitFor(async () => {
      const rows = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as any[]
      return created.every((createdRow) => rows.some((row) => row.id === createdRow.id && row.liveness === 'online'))
    }, 'all backend fixtures online', 3000)
    const preStop = [] as Array<{ status: number; ok: boolean; offline: boolean }>
    for (const row of created.slice(1, 3)) {
      const response = await fetch(`${base}/api/sessions/${row.id}/stop`, { method: 'POST' })
      const body = await response.json() as any
      await waitFor(async () => {
        const rows = await fetch(`${base}/api/sessions?all=1`).then((result) => result.json()) as any[]
        return rows.some((candidate) => candidate.id === row.id && candidate.liveness === 'offline')
      }, `${row.id} stopped offline`, 3000)
      preStop.push({ status: response.status, ok: body.ok, offline: true })
    }
    const exactTargets = async () => {
      const rows = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as any[]
      return created.map((createdRow) => {
        const row = rows.find((candidate) => candidate.id === createdRow.id)
        return {
          id: createdRow.id,
          lifecycle: row?.lifecycle ?? null,
          status: row?.status ?? null,
          liveness: row?.liveness ?? null,
          archived: row?.archived ?? null,
          proposal: row?.proposal ?? null,
          record: readFileSync(join(runtime, 'sessions', createdRow.id, 'session.json'), 'utf8'),
        }
      })
    }
    const capabilities = [
      { op: 'stop', sessionId: created[0].id },
      { op: 'resume', sessionId: created[1].id, force: false },
      { op: 'resume', sessionId: created[2].id, force: true },
    ]
    const acquire = await fetch(`${base}/api/session-maintenance/acquire`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capabilities, ttlMs: 30_000, waitMs: 10_000 }) })
    const lease = await acquire.json().catch(() => ({})) as any; token = lease.token || ''
    let heartbeat = { status: 0, ok: false }
    const negatives: Array<{ name: string; refused: boolean; code: string | null; targetsUnchanged: boolean }> = []
    let operationCodes: number[] = []; let operationBodies: any[] = []; let releaseCode = 0
    let staleBearer = { status: 0, code: null as string | null, targetsUnchanged: false }
    let finalLiveness: Record<string, string | null> = {}
    if (acquire.status === 201) {
      const headers = { 'content-type': 'application/json', 'x-spexcode-session-maintenance': token }
      const heartbeatResponse = await fetch(`${base}/api/session-maintenance/heartbeat`, {
        method: 'POST', headers, body: JSON.stringify({ epoch: lease.epoch, ttlMs: 30_000 }),
      })
      const heartbeatBody = await heartbeatResponse.json()
      heartbeat = { status: heartbeatResponse.status, ok: heartbeatBody.ok === true }

      const refuse = async (name: string, path: string, requestHeaders: Record<string, string>, body: unknown, expectedCode: string) => {
        const before = await exactTargets()
        const response = await fetch(`${base}${path}`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) })
        const responseBody = await response.json().catch(() => ({})) as any
        const after = await exactTargets()
        negatives.push({
          name,
          refused: !response.ok,
          code: responseBody.code ?? null,
          targetsUnchanged: JSON.stringify(after) === JSON.stringify(before),
        })
        assert.equal(responseBody.code, expectedCode, `${name} returns the exact structured refusal`)
      }
      await refuse('missing-token', `/api/sessions/${created[0].id}/stop`, { 'content-type': 'application/json' }, {}, 'maintenance_token_invalid')
      await refuse('wrong-token', `/api/sessions/${created[0].id}/stop`, { ...headers, 'x-spexcode-session-maintenance': '00'.repeat(32) }, {}, 'maintenance_token_invalid')
      await refuse('wrong-session', `/api/sessions/${created[3].id}/stop`, headers, {}, 'maintenance_capability_missing')
      await refuse('wrong-force', `/api/sessions/${created[2].id}/resume`, headers, { force: false }, 'maintenance_capability_missing')

      const stopResponse = await fetch(`${base}/api/sessions/${created[0].id}/stop`, { method: 'POST', headers })
      const stopBody = await stopResponse.json()
      await waitFor(async () => {
        const rows = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as any[]
        return rows.some((row) => row.id === created[0].id && row.liveness === 'offline')
      }, 'authorized stop target offline', 3000)
      const replayBefore = await exactTargets()
      const replayResponse = await fetch(`${base}/api/sessions/${created[0].id}/stop`, { method: 'POST', headers })
      const replayBody = await replayResponse.json().catch(() => ({})) as any
      const replayAfter = await exactTargets()
      negatives.push({
        name: 'replay', refused: !replayResponse.ok, code: replayBody.code ?? null,
        targetsUnchanged: JSON.stringify(replayAfter) === JSON.stringify(replayBefore),
      })
      assert.equal(replayBody.code, 'maintenance_capability_used', 'replay returns the exact structured refusal')

      const resumeOne = await fetch(`${base}/api/sessions/${created[1].id}/resume`, { method: 'POST', headers, body: JSON.stringify({ force: false }) })
      const resumeOneBody = await resumeOne.json()
      const resumeTwo = await fetch(`${base}/api/sessions/${created[2].id}/resume`, { method: 'POST', headers, body: JSON.stringify({ force: true }) })
      const resumeTwoBody = await resumeTwo.json()
      const responses = [stopResponse, resumeOne, resumeTwo]
      operationCodes = responses.map((response) => response.status)
      operationBodies = [stopBody, resumeOneBody, resumeTwoBody]
      await waitFor(async () => {
        const rows = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as any[]
        return rows.some((row) => row.id === created[1].id && row.liveness === 'online')
          && rows.some((row) => row.id === created[2].id && row.liveness === 'online')
      }, 'authorized resume targets online', 3000)
      const rows = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as any[]
      finalLiveness = Object.fromEntries(created.map((createdRow, index) => [
        ['stop', 'resumeOne', 'resumeTwo', 'control'][index],
        rows.find((row) => row.id === createdRow.id)?.liveness ?? null,
      ]))
      releaseCode = (await fetch(`${base}/api/session-maintenance/release`, { method: 'POST', headers, body: JSON.stringify({ epoch: lease.epoch }) })).status
      const staleBefore = await exactTargets()
      const staleResponse = await fetch(`${base}/api/sessions/${created[3].id}/stop`, { method: 'POST', headers })
      const staleBody = await staleResponse.json().catch(() => ({})) as any
      staleBearer = {
        status: staleResponse.status,
        code: staleBody.code ?? null,
        targetsUnchanged: JSON.stringify(await exactTargets()) === JSON.stringify(staleBefore),
      }
    }
    actual = {
      created: created.length, preStop, acquire: acquire.status, tokenBytes: token.length / 2,
      heartbeat, negatives, operationCodes, operationOk: operationBodies.map((result) => result.ok), finalLiveness, releaseCode, staleBearer,
    }
  } finally {
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore', env: { ...process.env, PATH: process.env.PATH?.split(':').filter((part) => part !== transportBin).join(':') } }) } catch {}
    child.kill('SIGTERM'); await backendDone()
    rmSync(dir, { recursive: true, force: true })
  }
  assert.deepEqual(actual, {
    created: 4,
    preStop: [{ status: 200, ok: true, offline: true }, { status: 200, ok: true, offline: true }],
    acquire: 201, tokenBytes: 32,
    heartbeat: { status: 200, ok: true },
    negatives: [
      { name: 'missing-token', refused: true, code: 'maintenance_token_invalid', targetsUnchanged: true },
      { name: 'wrong-token', refused: true, code: 'maintenance_token_invalid', targetsUnchanged: true },
      { name: 'wrong-session', refused: true, code: 'maintenance_capability_missing', targetsUnchanged: true },
      { name: 'wrong-force', refused: true, code: 'maintenance_capability_missing', targetsUnchanged: true },
      { name: 'replay', refused: true, code: 'maintenance_capability_used', targetsUnchanged: true },
    ],
    operationCodes: [200, 200, 200], operationOk: [true, true, true], releaseCode: 200,
    staleBearer: { status: 409, code: 'maintenance_conflict', targetsUnchanged: true },
    finalLiveness: { stop: 'offline', resumeOne: 'online', resumeTwo: 'online', control: 'online' },
  })
})
