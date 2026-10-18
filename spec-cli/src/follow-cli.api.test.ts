import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createServer as createNetServer, type Socket } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configuredSessionApplication } from './session-application.js'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const ID = 'wwww2222-2222-4222-8222-222222222222'
const WATCHER = 'wwww1111-1111-4111-8111-111111111111'
const seededParents = new Map<string, string | null>()

function row(status: string, archived = false): Record<string, unknown> {
  return {
    id: ID, branch: 'node/watch-cli', label: ID, title: ID,
    raw: { name: null, title: null }, path: `/wt/${ID}`, parent: null, harness: 'claude',
    capabilities: { headless: false }, launcher: null, lifecycle: 'active', proposal: null, merges: 0,
    status, liveness: status === 'offline' ? 'offline' : 'online', note: null, archived, archiveHazard: null,
    prompt: null, promptPreview: null, created: 0, activity: null, sortKey: null,
  }
}

type Run = { code: number | null; stdout: string; stderr: string }
// `onStderr` fires as the child narrates, so a test can wait for the follow to be REALLY running before it
// appends the transition it must observe. A timer instead makes the test race its own subject: a follower that
// starts late sees an already-actionable arrival and correctly refuses to return.
function startCli(args: string[], env: NodeJS.ProcessEnv, onStderr?: (all: string) => void, cwd = pkgRoot): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; onStderr?.(stderr) })
  return once(child, 'close').then(([code]) => ({ code: code as number | null, stdout, stderr }))
}
const runCli = (args: string[], env: NodeJS.ProcessEnv, cwd = pkgRoot): Promise<Run> => startCli(args, env, undefined, cwd)

function reviewFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'spex-follow-review-repo-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'spex fixture'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'spex-fixture@example.invalid'], { cwd: root })
  writeFileSync(join(root, 'README.md'), 'fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'fixture base'], { cwd: root, stdio: 'ignore' })
  execFileSync('git', ['switch', '-c', 'node/follow-cli'], { cwd: root, stdio: 'ignore' })
  writeFileSync(join(root, 'work.txt'), 'ahead\n')
  execFileSync('git', ['add', 'work.txt'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'fixture work'], { cwd: root, stdio: 'ignore' })
  return root
}

async function refusedPort(): Promise<number> {
  const s = createServer()
  s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const address = s.address(); assert.ok(address && typeof address === 'object')
  const port = address.port
  s.close(); await once(s, 'close')
  return port
}

// the store dir the CLI resolves for this project, so the test can BE the followed session's log writer
function seedSession(home: string, id = ID, parent: string | null = null, root = pkgRoot): string {
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim()
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim())
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
  mkdirSync(dir, { recursive: true })
  process.env.SPEXCODE_HOME = home
  process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  seededParents.set(id, parent)
  writeFileSync(join(dir, 'runtime.json'), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch: 'node/follow-cli',
    title: 'followed', name: '', parent,
    sortkey: null, createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
    archived: false, launcher: 'fixture', launch_cmd: 'true',
  }, null, 2)}\n`)
  return dir
}
const append = (dir: string, ev: Record<string, unknown>): void =>
  (() => {
    const id = dir.split('/').at(-1)!
    const app = configuredSessionApplication()!
    if (ev.kind === 'status') {
      const status = String(ev.status)
      const proposal = (ev.proposal as string | null) ?? null
      const note = (ev.note as string | null) ?? null
      if (app.readState(id)) app.transitionSession(id, { status, proposal, note, reason: 'follow-fixture' })
      else app.createSession({ sessionId: id, status, proposal, note, parentSessionId: seededParents.get(id) ?? null })
    } else if (ev.kind === 'sent') {
      if (!app.readState(id)) app.createSession({ sessionId: id, status: 'active' })
      app.enqueueConversationMessage(id, { kind: 'session.prompt.v1', body: Buffer.from(String(ev.text)), senderSessionId: (ev.from as string | null) ?? null, idempotencyKey: `follow-fixture:${id}:${String(ev.mid ?? ev.text)}` }, { text: String(ev.text), from: (ev.from as string | null) ?? null })
    }
  })()

const events = (dir: string): Array<{ kind: string; text?: string; from?: string | null }> => {
  const id = dir.split('/').at(-1)!
  const app = configuredSessionApplication()
  if (!app?.readState(id)) return []
  const messages = app.readPendingMessages(id).flatMap((message) => {
    const raw = Buffer.from(message.body).toString('utf8')
    if (raw.startsWith('[spex watch]')) return [{ kind: 'sent', text: raw, from: message.senderSessionId ?? null }]
    try {
      const state = JSON.parse(raw) as { sessionId?: string; status?: string; proposal?: string | null }
      if (!state.status) return []
      const display = state.status === 'awaiting' ? (state.proposal === 'merge' ? 'review' : state.proposal === 'close' ? 'close-pending' : 'done') : state.status === 'active' ? 'working' : state.status
      return [{ kind: 'sent', text: `[spex watch] ${state.sessionId ?? id} is ${display}`, from: message.senderSessionId ?? null }]
    } catch { return [] }
  })
  return messages.filter((message, index) => messages.findIndex((candidate) => candidate.text === message.text && candidate.from === message.from) === index)
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function startBackend(repo: string, env: NodeJS.ProcessEnv, port: number) {
  const child = spawn(process.execPath, [tsxCli, cli, 'serve', '--port', String(port)], {
    cwd: repo, env: { ...env, PORT: String(port) }, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let didClose = false
  const closed = new Promise<void>(resolve => child.once('close', () => { didClose = true; resolve() }))
  const ready = new Promise<void>((resolve, reject) => {
    let announced = false, stdout = '', log = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      log = (log + chunk).slice(-32_768)
      if (announced) return
      stdout += chunk
      if (!new RegExp(`^spec-cli supervisor serving on http://\\S+:${port} \\(`, 'm').test(stdout)) return
      announced = true
      resolve()
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { log = (log + chunk).slice(-32_768) })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (!announced) reject(new Error(`watch fixture backend closed before readiness (${code ?? signal})\n${log}`))
    })
  }).then(async () => {
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(health.status, 200, 'the supervisor announces readiness only after its backend is healthy')
    await health.body?.cancel()
  })
  return {
    ready,
    stop: async () => {
      if (!didClose && child.pid) {
        try {
          if (process.platform === 'win32') child.kill('SIGTERM')
          else process.kill(-child.pid, 'SIGTERM')
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      await closed
    },
  }
}

// A follow needs NO backend and no permission — it reads a file ([[session-follow]]). Everything here runs
// against a port with nothing listening; a `wait` that reached for the board would be visible as the client's
// local-store fallback notice on stderr.
test('spex session wait returns on a declaration with no backend running at all', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-follow-cli-'))
  const dir = seedSession(home)
  append(dir, { kind: 'status', status: 'active', proposal: null, note: null })
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(await refusedPort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]

  let moved = false
  const waited = startCli(['session', 'wait', ID, '--interval', '0.05', '--timeout', '45'], env, (all) => {
    // the follow is live once it has narrated its arrival; only THEN is a later append an observed transition
    if (moved || !all.includes('current status working')) return
    moved = true
    append(dir, { kind: 'status', status: 'awaiting', proposal: 'merge', note: 'ready to land' })
  })
  const r = await waited
  assert.ok(moved, 'the follower never narrated its arrival, so nothing was driven')
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'working→review')
  assert.doesNotMatch(r.stderr, /backend/i, 'a follow must never consult the board — not even to fall back from it')

  // a selector naming nothing is a usage failure (2); a target that never moves is the honest timeout (1)
  const missing = await runCli(['session', 'wait', 'no-such-session'], env)
  assert.equal(missing.code, 2, missing.stderr)
  const timedOut = await runCli(['session', 'wait', ID, '--interval', '0.05', '--timeout', '1'], env)
  assert.equal(timedOut.code, 1, timedOut.stderr)
  assert.match(timedOut.stderr, /timeout — observed no non-actionable→actionable transition/)
})

test('managed watch registers once, delivers child states, and cancel stops delivery', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-watch-cli-'))
  const repo = reviewFixture()
  const parentDir = seedSession(home, WATCHER, null, repo)
  const childDir = seedSession(home, ID, null, repo)
  append(parentDir, { kind: 'status', status: 'active', proposal: null, note: null })
  append(childDir, { kind: 'status', status: 'active', proposal: null, note: null })
  const base: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(await refusedPort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete base[key]
  const parentEnv = { ...base, SPEXCODE_SESSION_ID: WATCHER }
  const childEnv = { ...base, SPEXCODE_SESSION_ID: ID }
  const backendPort = await refusedPort()
  const backend = startBackend(repo, { ...base, SPEXCODE_TMUX: `spex-follow-cli-backend-${backendPort}` }, backendPort)

  try {
    await backend.ready
    const installed = await runCli(['session', 'watch', ID], parentEnv, repo)
    assert.equal(installed.code, 0, installed.stderr)
    assert.equal(installed.stdout.trim(), `watching ${ID}`)
    assert.equal(events(parentDir).filter((event) => event.kind === 'sent').length, 1, 'installation enqueues the current state')

    const listed = await runCli(['session', 'watch', 'list'], parentEnv, repo)
    assert.equal(listed.code, 0, listed.stderr)
    assert.match(listed.stdout, new RegExp(`^${ID}\\t`, 'm'))

    const declared = await runCli(['session', 'done', '--propose', 'merge'], childEnv, repo)
    assert.equal(declared.code, 0, declared.stderr)
    await waitFor(() => events(parentDir).some((event) => event.kind === 'sent' && /review/.test(event.text || '')), 'watch-delivered review')
    const review = events(parentDir).find((event) => event.kind === 'sent' && /review/.test(event.text || ''))
    assert.equal(review?.from, ID)
    assert.match(review?.text || '', /review/)

    const cancelled = await runCli(['session', 'watch', 'cancel', ID], parentEnv, repo)
    assert.equal(cancelled.code, 0, cancelled.stderr)
    assert.equal(cancelled.stdout.trim(), 'cancelled 1 watch')
    const asked = await runCli(['session', 'ask', '--note', 'need input'], childEnv, repo)
    assert.equal(asked.code, 0, asked.stderr)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(events(parentDir).some((event) => event.kind === 'sent' && /asking/.test(event.text || '')), false, 'cancel prevents later child delivery')

    const unmanaged = await runCli(['session', 'watch', ID], base, repo)
    assert.equal(unmanaged.code, 0, unmanaged.stderr)
    assert.match(unmanaged.stderr, new RegExp(`spex session wait ${ID}`))
    assert.equal(configuredSessionApplication()!.readState(ID)?.status, 'asking')
  } finally {
    await backend.stop()
  }
})

// The watcher's harness, as a rendezvous listener bound to the parent's stamped socket. A notice matching `holdOn`
// never gets its repaint answered, so whichever process hands that notice over sits on the rendezvous wall.
async function watcherHarness(parentDir: string, holdOn: RegExp, { attach = true } = {}) {
  const sockDir = mkdtempSync(join(tmpdir(), 'spex-rv-'))
  const sock = join(sockDir, 'p.sock')
  writeFileSync(join(parentDir, 'rv.path'), sock)
  const received: string[] = []
  const open = new Set<Socket>()
  const server = createNetServer((socket) => {
    open.add(socket)
    socket.on('close', () => open.delete(socket)).on('error', () => {})
    let buffer = '', held = false
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        let message: { type?: string; text?: string }
        try { message = JSON.parse(line) } catch { continue }
        if (message.type === 'reply') { received.push(message.text ?? ''); held = holdOn.test(message.text ?? '') }
        if (message.type === 'repaint' && !held) socket.write('{"type":"repaint-done"}\n')
      }
    })
  })
  server.listen(sock); await once(server, 'listening')
  const app = configuredSessionApplication()
  if (attach) app.attachWatcher(WATCHER, ID, 'watch:manual')
  app.bindRuntime(WATCHER, { namespace: 'spex-governed', runtimeKind: 'claude', nativeSessionId: WATCHER, nativeStartToken: 'start-1' })
  return {
    received,
    close: async () => { for (const socket of open) socket.destroy(); server.close(); await once(server, 'close') },
  }
}

function watchPair(home: string, repo: string): { parentDir: string; base: NodeJS.ProcessEnv } {
  const parentDir = seedSession(home, WATCHER, null, repo)
  const childDir = seedSession(home, ID, null, repo)
  append(parentDir, { kind: 'status', status: 'active', proposal: null, note: null })
  append(childDir, { kind: 'status', status: 'active', proposal: null, note: null })
  const base: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', CLAUDE_CONFIG_DIR: join(home, 'claude'), SPEXCODE_TMUX: `spex-follow-cli-${process.pid}-${Date.now()}` }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete base[key]
  return { parentDir, base }
}

// A declaration is a local state write; the watch delivery it wakes belongs to the backend that owns the watcher's
// channel ([[session-follow]]). The declaring CLI asks that backend to drain and returns — it never holds the parent's
// socket itself, so a harness that is slow to confirm the notice cannot hold the declaration.
test('a declaring CLI hands the watch delivery to the running backend and returns', { timeout: 90_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-watch-owner-'))
  const repo = reviewFixture()
  const { parentDir, base } = watchPair(home, repo)
  const harness = await watcherHarness(parentDir, /parked/)
  const backendPort = await refusedPort()
  const backend = startBackend(repo, base, backendPort)
  try {
    await backend.ready
    await waitFor(() => configuredSessionApplication().readPendingMessages(WATCHER).length === 0, 'the relation snapshot handed over', 15_000)
    const started = Date.now()
    const parked = await runCli(['session', 'park', '--note', 'held'], { ...base, SPEXCODE_SESSION_ID: ID, PORT: String(await refusedPort()) }, repo)
    const elapsed = Date.now() - started
    assert.equal(parked.code, 0, parked.stderr)
    assert.doesNotMatch(parked.stderr, /wake failed|handoff failed/)
    assert.ok(elapsed < 6_000, `the declaring CLI took ${elapsed}ms — it held the parent's unanswered socket instead of handing the drain to the backend`)
    await waitFor(() => harness.received.some((text) => /\[spex watch\] .* is parked — held/.test(text)), 'the backend delivered the parked notice', 10_000)
    const misrouted = await fetch(`http://127.0.0.1:${backendPort}/api/sessions/no-such-session/push`, { method: 'POST' })
    assert.equal(misrouted.status, 404, 'a backend holding no record for the session refuses the wake instead of answering ok')
  } finally {
    await backend.stop()
    await harness.close()
  }
})

// A send is accepted by its append, not by the handover already in flight ([[delivery-queue]]). While the backend
// sits on the parent's rendezvous wall with a watch notice, a peer message returns at once, stays owed behind that
// notice, and reaches the parent after it.
test('a send to a watcher whose harness is holding a watch notice does not wait behind it', { timeout: 90_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-send-behind-hold-'))
  const repo = reviewFixture()
  const { parentDir, base } = watchPair(home, repo)
  const harness = await watcherHarness(parentDir, /parked/)
  const backendPort = await refusedPort()
  const backend = startBackend(repo, base, backendPort)
  const childEnv = { ...base, SPEXCODE_SESSION_ID: ID, PORT: String(await refusedPort()) }
  const peer = 'a peer message behind the held notice'
  const owed = () => configuredSessionApplication().readPendingMessages(WATCHER).map((message) => Buffer.from(message.body).toString('utf8'))
  try {
    await backend.ready
    await waitFor(() => owed().length === 0, 'the relation snapshot handed over', 15_000)
    const parked = await runCli(['session', 'park', '--note', 'held'], childEnv, repo)
    assert.equal(parked.code, 0, parked.stderr)
    await waitFor(() => harness.received.some((text) => /is parked — held/.test(text)), 'the backend holding the parked notice on the wall', 10_000)
    const started = Date.now()
    const sent = await runCli(['session', 'send', WATCHER, peer], childEnv, repo)
    const elapsed = Date.now() - started
    assert.equal(sent.code, 0, sent.stderr)
    assert.ok(elapsed < 5_000, `send took ${elapsed}ms — it waited behind the handover in flight`)
    assert.ok(owed().some((text) => text.startsWith(peer)), 'the accepted send is owed on the parent queue')
    await waitFor(() => harness.received.some((text) => text.startsWith(peer)), 'the peer message reaching the parent after the held notice', 20_000)
    assert.ok(harness.received.findIndex((text) => /is parked — held/.test(text)) < harness.received.findIndex((text) => text.startsWith(peer)), 'order is kept')
  } finally {
    await backend.stop()
    await harness.close()
  }
})

test('with no backend, the declaring CLI hands the watch delivery over itself', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-watch-nobackend-'))
  const repo = reviewFixture()
  const { parentDir, base } = watchPair(home, repo)
  const harness = await watcherHarness(parentDir, /(?!)/)
  try {
    const parked = await runCli(['session', 'park', '--note', 'alone'], { ...base, SPEXCODE_SESSION_ID: ID, PORT: String(await refusedPort()) }, repo)
    assert.equal(parked.code, 0, parked.stderr)
    assert.doesNotMatch(parked.stderr, /wake failed|handoff failed/)
    await waitFor(() => harness.received.some((text) => /\[spex watch\] .* is parked — alone/.test(text)), 'the CLI delivered the parked notice itself')
    assert.equal(configuredSessionApplication().readPendingMessages(WATCHER).length, 0, 'nothing is left owed')
  } finally {
    await harness.close()
  }
})

// The CLI's other two local commits onto a watcher's queue take the same owner-first handover as a declaration:
// `watch` enqueues the target's current state to the caller itself, and a headless turn failure commits a watched
// child's `error`. `attach` is whether the relation already exists before the command runs.
const LOCAL_WATCH_COMMITS = [
  {
    name: 'spex session watch', attach: false, stdout: /^watching /, notice: /\[spex watch\] .* is working/,
    run: (env: NodeJS.ProcessEnv, repo: string) => runCli(['session', 'watch', ID], { ...env, SPEXCODE_SESSION_ID: WATCHER }, repo),
  },
  {
    name: 'spex internal session-turn-fail', attach: true, stdout: /^marked error/, notice: /\[spex watch\] .* is error — claude turn exited with exit code 1/,
    run: (env: NodeJS.ProcessEnv, repo: string) => runCli(['internal', 'session-turn-fail', ID, 'claude', '1'], env, repo),
  },
]

for (const entry of LOCAL_WATCH_COMMITS) {
  test(`${entry.name} hands the watch delivery to the running backend and returns`, { timeout: 90_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'spex-local-commit-owner-'))
    const repo = reviewFixture()
    const { parentDir, base } = watchPair(home, repo)
    const harness = await watcherHarness(parentDir, entry.notice, { attach: entry.attach })
    const backendPort = await refusedPort()
    const backend = startBackend(repo, base, backendPort)
    try {
      await backend.ready
      await waitFor(() => configuredSessionApplication().readPendingMessages(WATCHER).length === 0, 'the relation snapshot handed over', 15_000)
      const started = Date.now()
      const ran = await entry.run({ ...base, PORT: String(await refusedPort()) }, repo)
      const elapsed = Date.now() - started
      assert.equal(ran.code, 0, ran.stderr)
      assert.match(ran.stdout, entry.stdout)
      assert.doesNotMatch(ran.stderr, /wake failed|handoff failed/)
      assert.ok(elapsed < 6_000, `${entry.name} took ${elapsed}ms — it held the watcher's unanswered socket instead of handing the drain to the backend`)
      await waitFor(() => harness.received.some((text) => entry.notice.test(text)), 'the backend delivered the notice', 10_000)
    } finally {
      await backend.stop()
      await harness.close()
    }
  })

  test(`with no backend, ${entry.name} hands the watch delivery over itself`, { timeout: 60_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'spex-local-commit-nobackend-'))
    const repo = reviewFixture()
    const { parentDir, base } = watchPair(home, repo)
    const harness = await watcherHarness(parentDir, /(?!)/, { attach: entry.attach })
    try {
      const ran = await entry.run({ ...base, PORT: String(await refusedPort()) }, repo)
      assert.equal(ran.code, 0, ran.stderr)
      assert.match(ran.stdout, entry.stdout)
      assert.doesNotMatch(ran.stderr, /wake failed|handoff failed/)
      await waitFor(() => harness.received.some((text) => entry.notice.test(text)), 'the CLI delivered the notice itself')
      assert.equal(configuredSessionApplication().readPendingMessages(WATCHER).length, 0, 'nothing is left owed')
    } finally {
      await harness.close()
    }
  })
}

test('CLI stop and close exit nonzero when the backend commits no target transition', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && req.url === '/api/sessions?all=1') { res.end(JSON.stringify([row('working')])); return }
    if (req.method === 'POST' && (req.url === `/api/sessions/${ID}/stop` || req.url === `/api/sessions/${ID}/close`)) {
      res.end(JSON.stringify({ ok: false })); return
    }
    res.statusCode = 404; res.end('{}')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_API_URL: '' }
  try {
    const stopped = await runCli(['session', 'stop', ID, '--api', base], env)
    assert.equal(stopped.code, 1)
    assert.match(stopped.stderr, /no such session.*no stop transition was committed/)
    const closed = await runCli(['session', 'close', ID, '--api', base], env)
    assert.equal(closed.code, 1)
    assert.match(closed.stderr, /no such session.*no close was committed/)
  } finally {
    server.close(); await once(server, 'close')
  }
})
