import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configuredSessionApplicationIfCutover, resetConfiguredSessionApplicationForTest } from './session-application.js'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const ID = 'wwww2222-2222-4222-8222-222222222222'
const WATCHER = 'wwww1111-1111-4111-8111-111111111111'
const seededParents = new Map<string, string | null>()

function row(status: string, archived = false): Record<string, unknown> {
  return {
    id: ID, node: null, branch: 'node/watch-cli', label: ID, title: ID,
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
function startCli(args: string[], env: NodeJS.ProcessEnv, onStderr?: (all: string) => void): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; onStderr?.(stderr) })
  return once(child, 'close').then(([code]) => ({ code: code as number | null, stdout, stderr }))
}
const runCli = (args: string[], env: NodeJS.ProcessEnv): Promise<Run> => startCli(args, env)

async function refusedPort(): Promise<number> {
  const s = createServer()
  s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const address = s.address(); assert.ok(address && typeof address === 'object')
  const port = address.port
  s.close(); await once(s, 'close')
  return port
}

// the store dir the CLI resolves for this project, so the test can BE the followed session's log writer
function seedSession(home: string, id = ID, parent: string | null = null): string {
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgRoot, encoding: 'utf8' }).trim()
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
  mkdirSync(dir, { recursive: true })
  process.env.SPEXCODE_HOME = home
  process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  seededParents.set(id, parent)
  writeFileSync(join(dir, 'runtime.json'), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: worktree, branch: 'node/follow-cli', node: 'session-follow',
    title: 'followed', name: '', parent,
    sortkey: null, createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
    archived: false, launcher: 'fixture', launch_cmd: 'true',
  }, null, 2)}\n`)
  return dir
}
const append = (dir: string, ev: Record<string, unknown>): void =>
  (() => {
    const id = dir.split('/').at(-1)!
    const app = configuredSessionApplicationIfCutover()!
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
  resetConfiguredSessionApplicationForTest()
  const app = configuredSessionApplicationIfCutover()
  if (!app?.readState(id)) return []
  return app.readPendingMessages(id).map((message) => ({
    kind: 'sent',
    text: Buffer.from(message.body).toString('utf8'),
    from: message.senderSessionId ?? null,
  })).filter((message) => message.text.startsWith('[spex watch]'))
}
async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
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
  const parentDir = seedSession(home, WATCHER)
  const childDir = seedSession(home, ID, WATCHER)
  append(parentDir, { kind: 'status', status: 'active', proposal: null, note: null })
  append(childDir, { kind: 'status', status: 'active', proposal: null, note: null })
  const base: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(await refusedPort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete base[key]
  const parentEnv = { ...base, SPEXCODE_SESSION_ID: WATCHER }
  const childEnv = { ...base, SPEXCODE_SESSION_ID: ID }

  const installed = await runCli(['session', 'watch', ID], parentEnv)
  assert.equal(installed.code, 0, installed.stderr)
  assert.equal(installed.stdout.trim(), `watching ${ID}`)
  assert.equal(events(parentDir).filter((event) => event.kind === 'sent').length, 1, 'installation enqueues the current state')

  const listed = await runCli(['session', 'watch', 'list'], parentEnv)
  assert.equal(listed.code, 0, listed.stderr)
  assert.match(listed.stdout, new RegExp(`^${ID}\\t`, 'm'))

  const declared = await runCli(['session', 'done', '--propose', 'merge'], childEnv)
  assert.equal(declared.code, 0, declared.stderr)
  await waitFor(() => events(parentDir).filter((event) => event.kind === 'sent').length === 2, `watch-delivered review; queue=${JSON.stringify(events(parentDir))}`)
  const review = events(parentDir).at(-1)
  assert.equal(review?.from, ID)
  assert.match(review?.text || '', /review/)

  const cancelled = await runCli(['session', 'watch', 'cancel', ID], parentEnv)
  assert.equal(cancelled.code, 0, cancelled.stderr)
  assert.equal(cancelled.stdout.trim(), 'cancelled 1 watch')
  const asked = await runCli(['session', 'ask', '--note', 'need input'], childEnv)
  assert.equal(asked.code, 0, asked.stderr)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(events(parentDir).filter((event) => event.kind === 'sent').length, 2, 'cancel prevents later child delivery')

  const unmanaged = await runCli(['session', 'watch', ID], base)
  assert.equal(unmanaged.code, 0, unmanaged.stderr)
  assert.match(unmanaged.stderr, new RegExp(`spex session wait ${ID}`))
  assert.equal(configuredSessionApplicationIfCutover()!.readState(ID)?.status, 'asking')
})

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
