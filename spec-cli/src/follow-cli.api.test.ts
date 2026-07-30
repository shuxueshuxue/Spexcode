import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const ID = 'wwww2222-2222-4222-8222-222222222222'

function row(status: string, archived = false): Record<string, unknown> {
  return {
    id: ID, node: null, branch: 'node/watch-cli', label: ID, headline: ID,
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
function seedSession(home: string): string {
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgRoot, encoding: 'utf8' }).trim()
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify({
    session_id: ID, governed: true, worktree_path: worktree, branch: 'node/follow-cli', node: 'session-follow',
    title: 'followed', name: '', parent: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: Date.now(), harness: 'claude', harness_session_id: '', stopped: false,
    archived: false, launcher: 'fixture', launch_cmd: 'true',
  }, null, 2)}\n`)
  return dir
}
const append = (dir: string, ev: Record<string, unknown>): void =>
  appendFileSync(join(dir, 'timeline.ndjson'), `${JSON.stringify({ ts: new Date().toISOString(), ...ev })}\n`)

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
