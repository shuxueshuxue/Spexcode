import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { openProjectSessionApplication, type ProductionSessionApplication } from '@spexcode/session-application'
import { MESSAGE_KINDS } from '@spexcode/session-protocol'
import { initializeFreshSessionApplication, resetConfiguredSessionApplicationForTest } from './session-application.js'

// The three inbox shapes ([[inbox]]) driven through the real CLI against a fixture store, plus the registration
// the SessionStart hook performs. The store is opened out-of-process by the CLI and in-process here as the producer,
// which is exactly the shape a self-launched harness is in: no backend anywhere.
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const SELF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const STRANGER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
// a CLOSED port: the default (empty) API URL is the host's live :8787 backend, which a unit test must never reach, and
// fetch's "bad port" list (9, 1, …) fails without ECONNREFUSED, so the port is taken from a server we just closed.
const OFFLINE_API = await (async () => {
  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((r) => server.close(() => r()))
  return `http://127.0.0.1:${port}`
})()

type Run = { code: number | null; stdout: string; stderr: string }
type Fixture = { home: string; db: string; env: NodeJS.ProcessEnv; app: ProductionSessionApplication }

function fixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), 'spex-inbox-'))
  const db = join(home, 'sessions.sqlite')
  const env: NodeJS.ProcessEnv = {
    ...process.env, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: db, SPEXCODE_API_URL: OFFLINE_API, NODE_NO_WARNINGS: '1',
    SPEXCODE_SESSION_ID: SELF,
  }
  delete env.CLAUDE_CODE_SESSION_ID; delete env.CODEX_THREAD_ID
  // a `ready` store with its marker, as a governed backend leaves one behind; the CLI then registers the self-launched
  // address into it exactly as the SessionStart hook would.
  const previous = { home: process.env.SPEXCODE_HOME, db: process.env.SPEX_SESSION_DATABASE_PATH }
  process.env.SPEXCODE_HOME = home; process.env.SPEX_SESSION_DATABASE_PATH = db
  resetConfiguredSessionApplicationForTest()
  initializeFreshSessionApplication().close()
  resetConfiguredSessionApplicationForTest()
  process.env.SPEXCODE_HOME = previous.home; process.env.SPEX_SESSION_DATABASE_PATH = previous.db
  const registered = spawnSync(process.execPath, [tsxCli, cli, 'internal', 'session-register', SELF], { cwd: pkgRoot, env, encoding: 'utf8' })
  assert.equal(registered.status, 0, registered.stderr)
  assert.equal(registered.stdout.trim(), `registered ${SELF}`)
  const app = openProjectSessionApplication({ databasePath: db, locality: () => {} })
  assert.ok(app.readAddress(SELF), 'registration created the protocol address')
  return { home, db, env, app }
}
function run(args: string[], env: NodeJS.ProcessEnv): Run {
  const r = spawnSync(process.execPath, [tsxCli, cli, 'session', ...args], { cwd: pkgRoot, env, encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}
function enqueue(app: ProductionSessionApplication, to: string, text: string, from: string | null = null): string {
  return app.enqueueMessage(to, { kind: MESSAGE_KINDS.SESSION_TEXT, body: Buffer.from(text, 'utf8'), senderSessionId: from }).messageId
}

test('register: a fresh project has no ready store, so nothing is registered and nothing is created', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-inbox-fresh-'))
  const db = join(home, 'sessions.sqlite')
  const env = { ...process.env, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: db, SPEXCODE_API_URL: OFFLINE_API, NODE_NO_WARNINGS: '1' }
  const r = spawnSync(process.execPath, [tsxCli, cli, 'internal', 'session-register', SELF], { cwd: pkgRoot, env, encoding: 'utf8' })
  try {
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^skipped: .*cutover state fresh/)
    assert.equal(spawnSync('test', ['-e', db]).status, 1, 'no store was created by a skipped registration')
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('dequeue: one-shot takes exactly one message, then reports an empty queue', () => {
  const f = fixture()
  try {
    const again = spawnSync(process.execPath, [tsxCli, cli, 'internal', 'session-register', SELF], { cwd: pkgRoot, env: f.env, encoding: 'utf8' })
    assert.equal(again.stdout.trim(), `registered ${SELF}`, 'registration is idempotent')
    const empty = run(['dequeue', '--json'], f.env)
    assert.equal(empty.code, 0, empty.stderr)
    assert.equal(empty.stdout.trim(), 'null')
    const first = enqueue(f.app, SELF, 'hello, self-launch', STRANGER)
    enqueue(f.app, SELF, 'second in line')
    const taken = run(['dequeue', '--json'], f.env)
    assert.equal(taken.code, 0, taken.stderr)
    const parsed = JSON.parse(taken.stdout)
    assert.equal(parsed.messageId, first)
    assert.equal(parsed.text, 'hello, self-launch')
    assert.equal(parsed.from, STRANGER)
    assert.equal(f.app.readPendingMessages(SELF).length, 1, 'exactly one message was consumed')
    const block = run(['dequeue'], f.env)
    assert.match(block.stdout, /^from human · .*\nsecond in line\n$/)
    assert.equal(f.app.readPendingMessages(SELF).length, 0)
    const unregistered = run(['dequeue', '--session', STRANGER], f.env)
    assert.equal(unregistered.code, 2)
    assert.match(unregistered.stderr, /not a registered address/)
  } finally { f.app.close(); rmSync(f.home, { recursive: true, force: true }) }
})

test('wait-dequeue: blocks as a background command and exits with the one message that arrives', async () => {
  const f = fixture()
  try {
    const child = spawn(process.execPath, [tsxCli, cli, 'session', 'wait-dequeue', '--timeout', '20', '--interval', '0.1', '--json'], { cwd: pkgRoot, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c })
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c })
    await new Promise((r) => setTimeout(r, 1500))
    assert.equal(child.exitCode, null, 'still blocking with an empty queue')
    const id = enqueue(f.app, SELF, 'wake up')
    const [code] = await once(child, 'close') as [number | null]
    assert.equal(code, 0, stderr)
    assert.equal(JSON.parse(stdout).messageId, id)
    assert.match(stderr, /run it in the BACKGROUND/)
    const timeout = run(['wait-dequeue', '--timeout', '1', '--interval', '0.1'], f.env)
    assert.equal(timeout.code, 1)
    assert.equal(timeout.stdout, '')
    assert.match(timeout.stderr, /timeout/)
  } finally { f.app.close(); rmSync(f.home, { recursive: true, force: true }) }
})

test('stream-dequeue: a persistent monitor prints one line per message and only a signal ends it', async () => {
  const f = fixture()
  try {
    const child = spawn(process.execPath, [tsxCli, cli, 'session', 'stream-dequeue', '--interval', '0.1'], { cwd: pkgRoot, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const lines: string[] = []
    let buffer = ''
    child.stdout.setEncoding('utf8').on('data', (c) => { buffer += c; const parts = buffer.split('\n'); buffer = parts.pop()!; lines.push(...parts) })
    await new Promise((r) => setTimeout(r, 1200))
    enqueue(f.app, SELF, 'one')
    enqueue(f.app, SELF, 'two\nlines', STRANGER)
    enqueue(f.app, SELF, 'three')
    const deadline = Date.now() + 10_000
    while (lines.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
    assert.equal(lines.length, 3, `three messages, three lines: ${JSON.stringify(lines)}`)
    assert.match(lines[0], /^\[spex\] message · from human · .*: one$/)
    assert.match(lines[1], new RegExp(`from ${STRANGER} .*: two ⏎ lines$`))
    assert.equal(child.exitCode, null, 'a stream never exits on its own')
    assert.equal(f.app.readPendingMessages(SELF).length, 0, 'every printed line was consumed')
    child.kill('SIGTERM')
    const [code] = await once(child, 'close') as [number | null]
    assert.equal(code, 0)
  } finally { f.app.close(); rmSync(f.home, { recursive: true, force: true }) }
})

test('send to a registered recordless address with no backend queues locally; an unregistered id is refused', () => {
  const f = fixture()
  try {
    const sent = run(['send', SELF, 'hello from a shell'], { ...f.env, SPEXCODE_SESSION_ID: '' })
    assert.equal(sent.code, 0, sent.stderr)
    assert.match(sent.stderr, /queued for the receiver|backend unreachable/)
    const taken = run(['dequeue', '--json'], f.env)
    assert.equal(JSON.parse(taken.stdout).text, 'hello from a shell')
    const refused = run(['send', STRANGER, 'nobody home'], { ...f.env, SPEXCODE_SESSION_ID: '' })
    assert.notEqual(refused.code, 0)
    assert.equal(f.app.readAddress(STRANGER), null, 'a refused send minted no address')
  } finally { f.app.close(); rmSync(f.home, { recursive: true, force: true }) }
})
