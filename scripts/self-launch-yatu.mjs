#!/usr/bin/env node
// Self-launch synced YATU — the loop a person who started their own harness actually gets, end to end, with no
// backend anywhere and no governed record:
//
//   real `spex init` + real `spex materialize` write the hooks; the real `dispatch.sh` fires SessionStart and the
//   registration hook gives the harness's native session id an address in the project's canonical store;
//   `spex session send <native-id>` from a plain shell enqueues to that bare address (the backend is unreachable, so
//   the CLI says so and queues locally); the harness takes the message with each of the three inbox shapes:
//   `dequeue` (one-shot), `wait-dequeue` (a background command that exits on arrival), `stream-dequeue` (a
//   persistent monitor, one line per message, ended by a signal). Between produce and consume no resident process
//   exists, and an unregistered address is refused rather than minted.
//
// usage: node scripts/self-launch-yatu.mjs      (exit 0 = every assertion held; the FAIL line names the first that did not)
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const lines = []
const say = (t) => { lines.push(t); console.log(t) }
const fail = (m) => { throw new Error(m) }
const check = (cond, label) => { say(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) fail(label) }

const root = mkdtempSync(join(tmpdir(), 'self-launch-yatu-'))
const home = join(root, 'home'); mkdirSync(home)
const proj = join(root, 'project'); mkdirSync(proj)
say(`node ${process.version}`)
say(`fixture ${root}`)

// Everything the run touches lives under the fixture. The API URL names a CLOSED port on purpose: the default would
// be this host's live backend, and a proof of "no backend anywhere" must not be able to reach one by accident. The
// port comes from a server we just closed — fetch's "bad port" list (9, 1, …) fails WITHOUT ECONNREFUSED.
const closedPort = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const spexHome = join(home, '.spexcode')
const dbPath = join(spexHome, 'sessions.sqlite')
const baseEnv = {
  ...process.env, SPEXCODE_HOME: spexHome, HOME: home, TMPDIR: join(root, 'tmp'),
  SPEXCODE_API_URL: `http://127.0.0.1:${closedPort}`, SPEX_SESSION_DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1',
}
for (const k of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PORT']) delete baseEnv[k]
mkdirSync(baseEnv.TMPDIR, { recursive: true })

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd ?? proj, env: { ...baseEnv, ...(opts.env ?? {}) }, input: opts.input })
  if (!opts.allowFail && r.status !== 0) fail(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`)
  return r
}
const spex = join(repoRoot, 'bin', 'spex.mjs')
const spexArgs = (...a) => [spex, ...a]

// ---------------------------------------------------------------- a real project, real materialize
run('git', ['init', '-q', proj], { cwd: root })
run('git', ['-C', proj, 'config', 'user.email', 'yatu@example.test'], { cwd: root })
run('git', ['-C', proj, 'config', 'user.name', 'YATU'], { cwd: root })
writeFileSync(join(proj, 'README.md'), '# self-launch yatu fixture\n')
run('git', ['-C', proj, 'add', '-A'], { cwd: root })
run('git', ['-C', proj, 'commit', '-qm', 'fixture'], { cwd: root })
say(`init exit=${run(process.execPath, spexArgs('init', '--harness', 'claude')).status}`)
say(`materialize exit=${run(process.execPath, spexArgs('materialize')).status}`)

const encode = (p) => p.replace(/[/.]/g, '-')
const runtimeRoot = join(spexHome, 'projects', encode(dirname(join(proj, '.git'))))
const treeSlot = join(runtimeRoot, 'trees', encode(proj))
const manifestPath = join(treeSlot, 'hooks-manifest')
check(existsSync(manifestPath), `the real materialize wrote a manifest at ${manifestPath}`)
const manifest = readFileSync(manifestPath, 'utf8')
const listenerRows = manifest.split('\n').filter((l) => l.includes('session-listen/session-listen.sh'))
check(listenerRows.length === 1 && listenerRows[0].startsWith('SessionStart\t'), 'the registration hook is bound to SessionStart, and to nothing else, in the manifest the dispatcher reads')

// ---------------------------------------------------------------- the store a governed deployment leaves behind
// A project with no store gets NOTHING registered: the hook must never create a store to have somewhere to write.
const sid = 'a1b2c3d4-0000-4000-8000-00000000abcd'
const dispatch = join(repoRoot, 'spec-cli', 'hooks', 'dispatch.sh')
const fire = (event, session_id, extra = {}) => run('bash', [dispatch, 'claude', event], {
  allowFail: true, env: { SPEX: spex, ...extra }, input: JSON.stringify({ session_id, hook_event_name: event, cwd: proj }),
})
const fresh = fire('SessionStart', sid)
check(fresh.status === 0, `SessionStart with no store exits 0 (stderr: ${fresh.stderr.trim()})`)
check(!existsSync(dbPath), 'no store was created by a registration with nowhere to register')

// Now the store exists and is ready — as it would after a governed backend's first create or a live cutover.
run(process.execPath, ['-e', `
  import('@spexcode/session-application').then(m => {
    const { migrateJsonSessionRecords } = m
    migrateJsonSessionRecords({ databasePath: ${JSON.stringify(dbPath)}, recordsRoot: ${JSON.stringify(join(runtimeRoot, 'sessions'))}, locality: () => {} })
  })`], { cwd: repoRoot })
check(existsSync(dbPath) && existsSync(`${dbPath}.json-migration.json`), 'a ready canonical store with its marker exists')

// ---------------------------------------------------------------- registration through the real dispatcher
const started = fire('SessionStart', sid)
check(started.status === 0, `SessionStart through the real dispatcher exits 0 (stderr: ${started.stderr.trim()})`)
const readAddress = (id) => run(process.execPath, ['-e', `
  import('@spexcode/session-application').then(m => {
    const app = m.openProjectSessionApplication({ databasePath: ${JSON.stringify(dbPath)}, locality: () => {} })
    const a = app.readAddress(${JSON.stringify(id)}); const s = app.readState(${JSON.stringify(id)})
    // an unregistered address has no queue to read — the protocol refuses the read rather than answering "empty"
    console.log(JSON.stringify({ address: !!a, state: !!s, pending: a ? app.readPendingMessages(${JSON.stringify(id)}).length : null }))
    app.close()
  })`], { cwd: repoRoot }).stdout.trim()
let probe = JSON.parse(readAddress(sid))
check(probe.address && !probe.state, 'the native session id is a protocol address with NO application row (recordless, as self-launch must be)')
const again = fire('SessionStart', sid)
check(again.status === 0 && JSON.parse(readAddress(sid)).address, 're-registration is idempotent')

// ---------------------------------------------------------------- residency: nothing runs between produce and consume
// A process "of this run" is any spex invocation whose environment carries THIS fixture's SPEXCODE_HOME — argv alone
// cannot tell it from the host's own spex processes, so the probe reads /proc/<pid>/environ. A canary that carries the
// same environment must be visible first, or a zero here would be a blind probe's zero.
const residents = () => {
  const pids = spawnSync('pgrep', ['-f', 'spex.mjs'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
  return pids.filter((pid) => {
    try { return readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').includes(`SPEXCODE_HOME=${spexHome}`) } catch { return false }
  })
}
const canary = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', 'spex.mjs-canary'], { cwd: root, env: baseEnv })
await new Promise((r) => setTimeout(r, 300))
check(residents().includes(String(canary.pid)), `the residency probe can see a process of this run (canary ${canary.pid})`)
canary.kill()
await new Promise((r) => setTimeout(r, 300))
check(residents().length === 0, `no resident process exists between produce and consume (found ${residents().length})`)

// ---------------------------------------------------------------- produce: a plain shell sends to the bare address
const sent = run(process.execPath, spexArgs('session', 'send', sid, 'hello self-launch, from a shell'), { allowFail: true, cwd: proj })
check(sent.status === 0, `spex session send to the bare address exits 0 (stderr: ${sent.stderr.trim().split('\n').pop()})`)
check(/queued for the receiver/.test(sent.stderr), 'the CLI says the message is queued for the receiver because no backend can push it')
probe = JSON.parse(readAddress(sid))
check(probe.pending === 1 && !probe.state, 'exactly one pending message, still no application row')
const stranger = 'ffffffff-0000-4000-8000-00000000ffff'
const refused = run(process.execPath, spexArgs('session', 'send', stranger, 'nobody home'), { allowFail: true, cwd: proj })
check(refused.status !== 0 && !JSON.parse(readAddress(stranger)).address, 'an unregistered address is refused and NOT minted by the refused send')

// ---------------------------------------------------------------- consume 1: one-shot dequeue, as the harness itself
const asSelf = { CLAUDE_CODE_SESSION_ID: sid }
const one = run(process.execPath, spexArgs('session', 'dequeue', '--json'), { env: asSelf })
const msg = JSON.parse(one.stdout)
check(msg.text === 'hello self-launch, from a shell' && msg.from === null, `dequeue returned the message verbatim (${msg.messageId})`)
check(JSON.parse(readAddress(sid)).pending === 0, 'the message is gone from the queue: at-most-once')
const empty = run(process.execPath, spexArgs('session', 'dequeue', '--json'), { env: asSelf })
check(empty.stdout.trim() === 'null' && empty.status === 0, 'an empty queue is a normal null')

// ---------------------------------------------------------------- consume 2: wait-dequeue as a background command
const waiter = spawn(process.execPath, spexArgs('session', 'wait-dequeue', '--timeout', '30', '--interval', '0.1', '--json'), { cwd: proj, env: { ...baseEnv, ...asSelf }, stdio: ['ignore', 'pipe', 'pipe'] })
let waitOut = '', waitErr = ''
waiter.stdout.setEncoding('utf8').on('data', (c) => { waitOut += c })
waiter.stderr.setEncoding('utf8').on('data', (c) => { waitErr += c })
await new Promise((r) => setTimeout(r, 1500))
check(waiter.exitCode === null, 'wait-dequeue is still blocking on an empty queue')
run(process.execPath, spexArgs('session', 'send', sid, 'wake up'), { cwd: proj })
const waitCode = await new Promise((r) => waiter.on('close', r))
check(waitCode === 0 && JSON.parse(waitOut).text === 'wake up', 'wait-dequeue exited 0 with the one message that arrived — its exit is the wake-up')
check(/run it in the BACKGROUND/.test(waitErr), 'wait-dequeue told the caller to background it')

// ---------------------------------------------------------------- consume 3: stream-dequeue as a persistent monitor
const streamer = spawn(process.execPath, spexArgs('session', 'stream-dequeue', '--interval', '0.1'), { cwd: proj, env: { ...baseEnv, ...asSelf }, stdio: ['ignore', 'pipe', 'pipe'] })
const streamed = []
let buf = ''
streamer.stdout.setEncoding('utf8').on('data', (c) => { buf += c; const parts = buf.split('\n'); buf = parts.pop(); streamed.push(...parts) })
await new Promise((r) => setTimeout(r, 1200))
for (const t of ['first', 'second\nline', 'third']) run(process.execPath, spexArgs('session', 'send', sid, t), { cwd: proj })
const deadline = Date.now() + 15_000
while (streamed.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
check(streamed.length === 3, `three sends became three monitor lines (${streamed.length})`)
check(/: first$/.test(streamed[0]) && /: second ⏎ line$/.test(streamed[1]) && /: third$/.test(streamed[2]), 'each line carries its message, in FIFO order, newlines made visible')
check(streamer.exitCode === null, 'the stream did not exit on its own')
check(JSON.parse(readAddress(sid)).pending === 0, 'every streamed line was consumed')
streamer.kill('SIGTERM')
const streamCode = await new Promise((r) => streamer.on('close', r))
check(streamCode === 0, 'SIGTERM ends the stream cleanly')

check(residents().length === 0, `no resident process remains after the loop (found ${residents().length})`)
say(`self-launch-yatu: ${lines.filter((l) => l.startsWith('ok  ')).length} assertions passed`)
