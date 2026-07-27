import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const dispatch = fileURLToPath(new URL('../hooks/dispatch.sh', import.meta.url))
const tsx = join(pkgRoot, 'node_modules', '.bin', 'tsx')
const home = mkdtempSync(join(tmpdir(), 'spex-maintenance-seams-a-'))
process.env.SPEXCODE_HOME = home
process.env.SPEXCODE_TMUX = `spex-maintenance-a-${process.pid}`
after(() => rmSync(home, { recursive: true, force: true }))

const TOKEN = '71'.repeat(32)
const ID = 'a1111111-1111-4111-8111-111111111111'
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as any

function leaseRow(state: 'open' | 'active', pid: number, startToken: string) {
  return {
    version: 1,
    state,
    epoch: 41,
    tokenHash: state === 'active' ? createHash('sha256').update(TOKEN).digest('hex') : null,
    owner: state === 'active' ? { pid, startToken } : null,
    heartbeatDeadline: state === 'active' ? Date.now() + 60_000 : null,
    capabilities: state === 'active' ? [{ capability: { op: 'stop', sessionId: ID }, state: 'unused' }] : [],
    tickets: [],
  }
}

function sessionRow(worktree: string) {
  return {
    session_id: ID, governed: true, worktree_path: worktree, branch: 'node/maintenance-fixture',
    node: '', title: 'maintenance fixture', name: '', parent: '', status: 'active', proposal: '', merges: 0,
    note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
    archived: false, cold_proof: '', adapter_recovery: '', launcher: 'claude', launch_cmd: '', launch_owner: '',
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

test('existing create/send/input/hook-state/queue/sort seams refuse a durable active lease before effects', async () => {
  const [{ runtimeRoot, sessionRecordPath }, { processStartToken }, sessions, pty] = await Promise.all([
    import('./layout.js'), import('./process-identity.js'), import('./sessions.js'), import('./pty-bridge.js'),
  ])
  const root = runtimeRoot()
  const leasePath = join(root, 'session-maintenance.json')
  const worktree = mkdtempSync(join(tmpdir(), 'spex-maintenance-record-a-'))
  const recordPath = sessionRecordPath(ID)
  mkdirSync(dirname(recordPath), { recursive: true })
  writeFileSync(recordPath, JSON.stringify(sessionRow(worktree), null, 2))
  const startToken = processStartToken(process.pid)
  assert.ok(startToken)
  writeFileSync(leasePath, JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const leaseBefore = readFileSync(leasePath, 'utf8')
  const recordBefore = readFileSync(recordPath, 'utf8')
  let createEffects = 0

  const create = await capture(() => sessions.sessionCreateRequest({ prompt: 'blocked create', parent: null }, async () => {
    createEffects++
    return { id: 'must-not-exist' } as any
  }))
  const send = await capture(() => sessions.sendText('missing-target', 'blocked send'))
  const rawKey = await capture(() => sessions.rawKey('missing-target', 'Enter'))
  const terminal = await capture(() => pty.forwardInput(ID, { send() {} }, 'x'))
  const hookState = await capture(() => sessions.markState('parked', { sessionId: ID, note: 'must-not-land' }))
  const queue = await capture(() => sessions.drainQueue())
  const sort = await capture(() => sessions.setSessionSort(ID, 1234))

  rmSync(worktree, { recursive: true, force: true })
  assert.deepEqual({
    codes: [create.code, send.code, rawKey.code, terminal.code, hookState.code, queue.code, sort.code],
    createEffects,
    leaseUnchanged: readFileSync(leasePath, 'utf8') === leaseBefore,
    recordUnchanged: readFileSync(recordPath, 'utf8') === recordBefore,
  }, {
    codes: Array(7).fill('maintenance_active'),
    createEffects: 0,
    leaseUnchanged: true,
    recordUnchanged: true,
  })
})

test('real no-backend session new fallback refuses before record, worktree, branch, tmux, or launcher effects', async () => {
  const { processStartToken } = await import('./process-identity.js')
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-fallback-a-'))
  const projectPath = join(dir, 'project')
  mkdirSync(projectPath, { recursive: true })
  const project = realpathSync(projectPath)
  const fallbackHome = join(dir, 'home')
  const runtime = join(fallbackHome, 'projects', project.replace(/[/.]/g, '-'))
  const tmux = `spex-maintenance-fallback-${process.pid}-${Date.now()}`
  mkdirSync(join(project, '.spec'), { recursive: true })
  cpSync(join(pkgRoot, 'templates', 'spec', 'project'), join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: join(pkgRoot, 'test', 'fixtures', 'fake-claude') } }, defaultLauncher: 'fake' },
  }, null, 2))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=maintenance-fixture', '-c', 'user.email=maintenance@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  mkdirSync(runtime, { recursive: true })
  const startToken = processStartToken(process.pid)
  assert.ok(startToken)
  writeFileSync(join(runtime, 'session-maintenance.json'), JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const result = spawnSync(tsx, [cli, 'session', 'new', 'fallback must be blocked', '--launcher', 'fake', '--api', 'http://127.0.0.1:1'], {
    cwd: project,
    env: { ...process.env, SPEXCODE_HOME: fallbackHome, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '', FAKE_HARNESS_INTERVAL_MS: '50' },
    encoding: 'utf8', timeout: 30_000,
  })
  const sessionDirs = existsSync(join(runtime, 'sessions')) ? readdirSync(join(runtime, 'sessions')) : []
  const worktreeCount = existsSync(join(project, '.worktrees')) ? readdirSync(join(project, '.worktrees')).length : 0
  const branches = execFileSync('git', ['branch', '--list', 'node/*'], { cwd: project, encoding: 'utf8' }).trim()
  const actual = {
    status: result.status,
    structured: /maintenance_active/.test(result.stdout + result.stderr),
    sessionDirs: sessionDirs.length,
    worktreeCount,
    branchCount: branches ? branches.split('\n').length : 0,
  }
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 1, structured: true, sessionDirs: 0, worktreeCount: 0, branchCount: 0 })
})

test('real hook dispatcher blocks structurally and invokes zero handlers', async () => {
  const { processStartToken } = await import('./process-identity.js')
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-hook-a-'))
  const hookHome = join(dir, 'home')
  const runtime = join(hookHome, 'projects', dir.replace(/[/.]/g, '-'))
  const marker = join(dir, 'handler-ran')
  const manifest = join(dir, 'hooks-manifest')
  const script = join(dir, 'handler.sh')
  spawnSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(runtime, { recursive: true })
  const startToken = processStartToken(process.pid)
  assert.ok(startToken)
  writeFileSync(join(runtime, 'session-maintenance.json'), JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  writeFileSync(script, `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\n`)
  writeFileSync(manifest, `PreToolUse\t10\ttrue\t${script.slice(dir.length + 1)}\n`)
  const before = readFileSync(join(runtime, 'session-maintenance.json'), 'utf8')
  const result = spawnSync('bash', [dispatch, 'claude', 'PreToolUse'], {
    cwd: dir,
    env: { ...process.env, SPEXCODE_HOME: hookHome, SPEX_HOOK_MANIFEST: manifest, SPEX: join(repoRoot, 'spec-cli', 'bin', 'spex.mjs') },
    input: JSON.stringify({ session_id: ID, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'true' } }),
    encoding: 'utf8',
  })
  const actual = {
    status: result.status,
    structured: /maintenance_active/.test(result.stdout + result.stderr),
    handlerRan: existsSync(marker),
    durableUnchanged: readFileSync(join(runtime, 'session-maintenance.json'), 'utf8') === before,
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 2, structured: true, handlerRan: false, durableUnchanged: true })
})

test('internal shared spawn rejects direct or forged maintenance authority before process creation', async () => {
  const [{ runtimeRoot }, { processStartToken }] = await Promise.all([import('./layout.js'), import('./process-identity.js')])
  const root = runtimeRoot()
  const leasePath = join(root, 'session-maintenance.json')
  const startToken = processStartToken(process.pid)
  assert.ok(startToken)
  writeFileSync(leasePath, JSON.stringify(leaseRow('active', process.pid, startToken), null, 2))
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-spawn-a-'))
  const marker = join(dir, 'spawned')
  const result = spawnSync(tsx, [cli, 'internal', 'shared-runtime-spawn', dir, join(dir, 'runtime.log'), join(dir, 'runtime.pid'), join(dir, 'runtime.scope'), 'bash', '-c', `echo ran > ${marker}`], {
    cwd: pkgRoot,
    env: { ...process.env, SPEXCODE_MAINTENANCE_DELEGATE: 'ff'.repeat(32) },
    encoding: 'utf8',
  })
  for (let i = 0; i < 20 && !existsSync(marker); i++) await sleep(10)
  const actual = {
    status: result.status,
    structured: /maintenance_active|maintenance_delegate_invalid/.test(result.stdout + result.stderr),
    spawned: existsSync(marker),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 1, structured: true, spawned: false })
})

function publicRow() {
  return {
    id: ID, node: null, branch: 'node/fixture', path: '/tmp/fixture', label: ID, headline: ID,
    raw: { name: null, title: null }, parent: null, harness: 'claude', capabilities: { headless: false },
    launcher: 'claude', lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online',
    note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
  }
}

test('scoped session maintain wrapper keeps bearer in memory and brokers one exact nested stop', async () => {
  const seen: { path: string; header: string | null }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      seen.push({ path: req.url || '', header: req.headers['x-spexcode-session-maintenance'] as string ?? null })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/sessions?all=1') return res.end(JSON.stringify([publicRow()]))
      if (req.url === '/api/session-maintenance/acquire') { res.statusCode = 201; return res.end(JSON.stringify({ state: 'active', epoch: 7, token: TOKEN })) }
      if (req.url === '/api/session-maintenance/heartbeat') return res.end(JSON.stringify({ ok: true }))
      if (req.url === '/api/session-maintenance/release') return res.end(JSON.stringify({ ok: true }))
      if (req.url === `/api/sessions/${ID}/stop`) return res.end(JSON.stringify({ ok: true }))
      res.statusCode = 404; res.end('{}')
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-wrapper-a-'))
  const childEnv = join(dir, 'child.env')
  const shell = `env > ${JSON.stringify(childEnv)}; exec ${JSON.stringify(tsx)} ${JSON.stringify(cli)} session stop ${ID} --api ${JSON.stringify(base)}`
  const result = spawnSync(tsx, [cli, 'session', 'maintain', '--allow-stop', ID, '--api', base, '--', 'bash', '-c', shell], {
    cwd: pkgRoot, env: { ...process.env, SPEXCODE_API_URL: '' }, encoding: 'utf8',
  })
  server.close(); await once(server, 'close')
  const childEnvironment = existsSync(childEnv) ? readFileSync(childEnv, 'utf8') : ''
  const actual = {
    status: result.status,
    acquired: seen.some((entry) => entry.path === '/api/session-maintenance/acquire'),
    stoppedWithHeader: seen.some((entry) => entry.path === `/api/sessions/${ID}/stop` && entry.header === TOKEN),
    released: seen.some((entry) => entry.path === '/api/session-maintenance/release'),
    tokenInOutput: (result.stdout + result.stderr).includes(TOKEN),
    tokenInChildEnv: childEnvironment.includes(TOKEN),
    brokerFdOnly: /SPEXCODE_MAINTENANCE_BROKER_FDS=/.test(childEnvironment),
  }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { status: 0, acquired: true, stoppedWithHeader: true, released: true, tokenInOutput: false, tokenInChildEnv: false, brokerFdOnly: true })
})

test('actual session attach owns a durable ticket for its complete foreground lifetime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-maintenance-attach-a-'))
  const attachHome = join(dir, 'home')
  const runtime = join(attachHome, 'projects', repoRoot.replace(/[/.]/g, '-'))
  const leasePath = join(runtime, 'session-maintenance.json')
  const bin = join(dir, 'bin'); const attached = join(dir, 'attached'); const release = join(dir, 'release'); const tty = join(dir, 'tty.cjs')
  mkdirSync(runtime, { recursive: true }); mkdirSync(bin)
  writeFileSync(leasePath, JSON.stringify(leaseRow('open', process.pid, ''), null, 2))
  writeFileSync(tty, "Object.defineProperty(process.stdin,'isTTY',{value:true});Object.defineProperty(process.stdout,'isTTY',{value:true});\n")
  writeFileSync(join(bin, 'tmux'), `#!/usr/bin/env bash\ncase "$*" in *attach-session*) touch ${JSON.stringify(attached)}; while [ ! -f ${JSON.stringify(release)} ]; do sleep 0.02; done;; esac\nexit 0\n`)
  chmodSync(join(bin, 'tmux'), 0o755)
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/sessions?all=1') return res.end(JSON.stringify([publicRow()]))
    res.statusCode = 404; res.end('{}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const child = spawn(tsx, [cli, 'session', 'attach', ID, '--api', `http://127.0.0.1:${address.port}`], {
    cwd: pkgRoot,
    env: { ...process.env, SPEXCODE_HOME: attachHome, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--require=${tty}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (let i = 0; i < 200 && !existsSync(attached); i++) await sleep(10)
  const during = json(leasePath).tickets.some((ticket: any) => ticket.operation === 'attach' && ticket.sessionId === ID)
  writeFileSync(release, '')
  await once(child, 'close')
  for (let i = 0; i < 100 && json(leasePath).tickets.length; i++) await sleep(10)
  const afterAttach = json(leasePath).tickets.some((ticket: any) => ticket.operation === 'attach')
  server.close(); await once(server, 'close')
  const actual = { attached: existsSync(attached), during, afterAttach }
  rmSync(dir, { recursive: true, force: true })
  assert.deepEqual(actual, { attached: true, during: true, afterAttach: false })
})

test('real isolated backend exposes authenticated maintenance lifecycle without leaking its bearer', async () => {
  const portProbe = createServer()
  portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening')
  const probeAddress = portProbe.address(); assert.ok(probeAddress && typeof probeAddress === 'object')
  const port = probeAddress.port
  portProbe.close(); await once(portProbe, 'close')
  const apiHome = mkdtempSync(join(tmpdir(), 'spex-maintenance-api-a-'))
  const child = spawn(tsx, [fileURLToPath(new URL('./index.ts', import.meta.url))], {
    cwd: pkgRoot, env: { ...process.env, PORT: String(port), SPEXCODE_HOME: apiHome, SPEXCODE_TMUX: `maintenance-api-${process.pid}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break } catch {}
    await sleep(10)
  }
  let token = ''
  try {
    const statusBefore = await fetch(`${base}/api/session-maintenance`)
    const acquire = await fetch(`${base}/api/session-maintenance/acquire`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: [], ttlMs: 5_000, waitMs: 0 }),
    })
    const acquired = await acquire.json().catch(() => ({})) as any
    token = acquired.token || ''
    const headers = { 'content-type': 'application/json', 'x-spexcode-session-maintenance': token }
    const heartbeat = await fetch(`${base}/api/session-maintenance/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ epoch: acquired.epoch, ttlMs: 5_000 }) })
    const releaseResult = await fetch(`${base}/api/session-maintenance/release`, { method: 'POST', headers, body: JSON.stringify({ epoch: acquired.epoch }) })
    const statusAfter = await fetch(`${base}/api/session-maintenance`)
    assert.deepEqual({ codes: [statusBefore.status, acquire.status, heartbeat.status, releaseResult.status, statusAfter.status], tokenBytes: token.length / 2 }, {
      codes: [200, 201, 200, 200, 200], tokenBytes: 32,
    })
  } finally {
    child.kill('SIGTERM'); await once(child, 'close')
    assert.equal(Boolean(token && output.includes(token)), false, 'backend stdout/stderr never carries the bearer')
    rmSync(apiHome, { recursive: true, force: true })
  }
})
