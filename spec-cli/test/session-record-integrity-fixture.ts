// No-model product fixture for session-record INTEGRITY: every note-carrying declaration entry must survive a
// full round trip through the real product surfaces — the real CLI declaration verbs, the real hook dispatcher,
// the real backend read routes — with a note carrying the characters that break string-assembled JSON.
// Run against a backend whose claude launcher resolves to spec-cli/test/fixtures/fake-claude:
//   BASE=http://127.0.0.1:8787 npx tsx test/session-record-integrity-fixture.ts
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { codexAppServerSock, rvSock } from '../src/harness.js'
import { runtimeRoot } from '../src/layout.js'
import { processStartToken } from '../src/process-identity.js'

const pexec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const LAUNCHER = process.env.LAUNCHER || 'claude'
const SPEX = process.env.SPEX_BIN || join(packageRoot, 'bin', 'spex.mjs')
const DISPATCH = join(packageRoot, 'hooks', 'dispatch.sh')
const SESSION_PROMPT = `record integrity fixture ${process.pid}-${Date.now()}`

// The one payload every entry is measured with: a double quote (the reported corruption), a backslash (the
// other JSON escape), a real newline (which a one-field-per-line record must encode, not split), and non-ASCII
// (which must survive byte-for-byte). Anything that assembles JSON by string substitution dies on this.
const NASTY = 'he said "strict" — path C:\\tmp\\x\nsecond line 中文 ✅'
// The string that actually caused the incident: mark-active.sh's own comment, quoted verbatim in a note by a
// session discussing the bug. Measuring the write path against the real trigger — not only a constructed one —
// is what proves the class is closed rather than one convenient example of it.
const REAL_TRIGGER = 'Escape \\ / & in the note for the sed REPLACEMENT (the note never contains ").'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const serverFrame = (value: unknown): Buffer => {
  const payload = Buffer.from(JSON.stringify(value))
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
  const header = Buffer.alloc(4)
  header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2)
  return Buffer.concat([header, payload])
}

// A narrow real-socket Codex control-plane fixture. It speaks only the public adapter probe requests, but it
// crosses the same Unix WebSocket and backend stop/close routes as a real app-server.
async function fakeLoadedThreadRuntime(threadId: string): Promise<() => Promise<void>> {
  const path = codexAppServerSock(runtimeRoot())
  rmSync(path, { force: true })
  const clients = new Set<Socket>()
  const server = createServer((socket) => {
    clients.add(socket)
    socket.once('close', () => clients.delete(socket))
    let upgraded = false
    let buf = Buffer.alloc(0)
    const drain = () => {
      for (;;) {
        if (!upgraded) {
          const end = buf.indexOf('\r\n\r\n')
          if (end < 0) return
          const head = buf.subarray(0, end).toString('utf8')
          const key = head.match(/^Sec-WebSocket-Key:\s*(.+)$/mi)?.[1]?.trim() ?? ''
          const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
          buf = buf.subarray(end + 4)
          upgraded = true
        }
        if (buf.length < 2) return
        let length = buf[1] & 0x7f
        let offset = 2
        if (length === 126) { if (buf.length < 4) return; length = buf.readUInt16BE(2); offset = 4 }
        if (length === 127) return socket.destroy(new Error('fixture frame too large'))
        const masked = (buf[1] & 0x80) !== 0
        const frameLength = offset + (masked ? 4 : 0) + length
        if (buf.length < frameLength) return
        const mask = masked ? buf.subarray(offset, offset + 4) : null
        if (mask) offset += 4
        const payload = Buffer.from(buf.subarray(offset, offset + length))
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
        buf = buf.subarray(frameLength)
        let message: any
        try { message = JSON.parse(payload.toString('utf8')) } catch { continue }
        if (message.id === 1) socket.write(serverFrame({ id: 1, result: {} }))
        else if (message.id === 2) socket.write(serverFrame({ id: 2, result: { data: [{ id: threadId }] } }))
        else if (typeof message.id === 'number' && message.method === 'thread/read') {
          socket.write(serverFrame({ id: message.id, result: { thread: { id: threadId, status: { type: 'idle' } } } }))
        }
      }
    }
    socket.on('data', (chunk) => { buf = Buffer.concat([buf, chunk]); drain() })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => resolve())
  })
  return async () => {
    for (const client of clients) client.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(path, { force: true })
  }
}

async function jsonRequest(path: string, init: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  const response = await fetch(`${BASE}${path}`, init)
  const text = await response.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* text response */ }
  return { status: response.status, body, text }
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(100)
  }
}

async function createSession(): Promise<{ id: string; path: string; branch: string | null }> {
  const response = await jsonRequest('/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: SESSION_PROMPT, launcher: LAUNCHER }),
  })
  assert.equal(response.status, 201, `POST /api/sessions failed: ${response.text}`)
  return { id: response.body.id, path: response.body.path, branch: response.body.branch ?? null }
}

// the real CLI declaration verb an agent types, run exactly as an agent would (cwd = its worktree).
async function spex(cwd: string, ...args: string[]): Promise<string> {
  const { stdout, stderr } = await pexec(process.execPath, [SPEX, ...args], { cwd, env: process.env })
  return stdout + stderr
}

// the real hook entry point a harness fires: the dispatcher, in the session worktree, fed the real payload
// shape on stdin. Not the handler script directly — the shim binds THIS line.
async function fireHook(cwd: string, event: string, payload: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile('bash', [DISPATCH, 'claude', event], { cwd, env: { ...process.env, SPEX } }, (error) => {
      // a Stop-gate style block exits 2; PreToolUse handlers never block, so anything non-zero is a real failure
      if (error && (error as any).code !== 0) reject(new Error(`${event} hook failed: ${error.message}`))
      else resolve()
    })
    child.stdin?.end(JSON.stringify(payload))
  })
}

// the record path, resolved the way the product resolves it: the project key is the MAIN checkout (dirname of
// the shared git common dir), encoded with the store's separator scheme. Derived here rather than passed in, so
// the fixture reads the same file the backend and the hooks write.
async function recordPath(home: string, worktree: string, id: string): Promise<string> {
  const { stdout } = await pexec('git', ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  const enc = dirname(stdout.trim()).replace(/[/.]/g, '-')
  return join(home, 'projects', enc, 'sessions', id, 'session.json')
}

async function readSession(id: string): Promise<any> {
  const response = await jsonRequest(`/api/sessions/${id}`)
  assert.equal(response.status, 200, `GET /api/sessions/${id} failed: ${response.status} ${response.text}`)
  return response.body
}

// ---- phase 2: a record nothing can parse ------------------------------------------------------------
// It must never read as a plain missing session (the reported failure: a LIVE session answered
// "no session record"), it must never be silently repaired into a valid empty record by a hook, and close
// must quarantine evidence then fail before touching any runtime/worktree/branch it cannot own.
async function corruptRecordIsDiagnosable(home: string, worktree: string): Promise<void> {
  // NOT a hand-built string: these are the real bytes the old shell writer produced during the incident
  // (session 67c463e8 quoted mark-active.sh's own "the note never contains \"" comment in a note, and the sed
  // write path closed the JSON string on that quote). Measuring against the artifact means the fixture cannot
  // drift into a shape that is merely convenient to detect.
  const incident = readFileSync(join(packageRoot, 'test', 'fixtures', 'corrupt-session-record.json'), 'utf8')
  const cid = JSON.parse(incident.split('\n')[1].replace(/^\s*"session_id":\s*/, '').replace(/,$/, ''))
  // HARD GUARD. The incident shape is preserved, but its already-synthetic owner paths are rebound to exact
  // disposable assets so the product proof can assert every residue survives.
  assert.match(cid, /^0{8}-0{4}-4000-8000-/, `the corrupt fixture must carry a SYNTHETIC session id, got ${cid}`)
  const preservedWorktree = join(dirname(worktree), `corrupt-record-residue-${process.pid}`)
  const preservedBranch = `node/corrupt-record-residue-${process.pid}`
  const sample = incident
    .replace('/tmp/spexcode-fixture-worktree/corrupt-record-0000', preservedWorktree)
    .replace('node/corrupt-record-fixture-0000', preservedBranch)
  const rec = await recordPath(home, worktree, cid)
  mkdirSync(dirname(rec), { recursive: true })
  mkdirSync(preservedWorktree, { recursive: true })
  writeFileSync(join(preservedWorktree, 'unmerged.txt'), 'must survive corrupt close\n')
  await pexec('git', ['-C', worktree, 'branch', preservedBranch])
  const tmux = process.env.SPEXCODE_TMUX
  assert.ok(tmux, 'fixture tmux socket name is explicit')
  await pexec('tmux', ['-L', tmux!, 'new-session', '-d', '-s', cid, 'sleep 300'])
  const paneBefore = (await pexec('tmux', ['-L', tmux!, 'display-message', '-p', '-t', cid, '#{pane_pid}'])).stdout.trim()
  const adapterTransport = rvSock(cid)
  rmSync(adapterTransport, { force: true })
  writeFileSync(adapterTransport, 'must survive without guessed defaultHarness cleanup\n')
  const stopSharedRuntime = await fakeLoadedThreadRuntime('thread-without-readable-record')
  writeFileSync(rec, sample)
  const runtimeSentinel = join(dirname(rec), 'runtime-sentinel')
  writeFileSync(runtimeSentinel, 'must survive corrupt close\n')
  const agent = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 120000)', cid], { stdio: 'ignore' })
  let agentStart: string | null = null
  for (let i = 0; i < 50 && !(agentStart = processStartToken(agent.pid!)); i++) await sleep(20)
  assert.ok(agentStart, 'corrupt fixture acquired an exact signalable agent PID/start identity')
  writeFileSync(join(dirname(rec), 'agent.pid'), `${agent.pid}\n`)
  const cleanupAgent = () => {
    if (agent.pid && processStartToken(agent.pid) === agentStart) {
      try { process.kill(agent.pid, 'SIGTERM') } catch { /* already exited */ }
    }
  }
  process.once('exit', cleanupAgent)
  const original = readFileSync(rec, 'utf8')
  assert.equal(original, sample, 'the incident bytes are planted verbatim')
  assert.throws(() => JSON.parse(original), 'the incident record really is unparseable')

  const listed = await jsonRequest('/api/sessions')
  assert.equal(listed.status, 200, `GET /api/sessions with a corrupt row failed: ${listed.text}`)
  assert.ok(Array.isArray(listed.body), `GET /api/sessions returned a non-list: ${listed.text}`)
  const rows = listed.body as any[]
  const row = rows.find((s) => s.id === cid)
  assert.ok(row, 'a corrupt record still occupies its row — it never silently vanishes from the list')
  assert.equal(row.status, 'corrupt', 'the row carries a distinct corrupt state, not a guessed lifecycle')
  assert.match(String(row.note ?? ''), /session\.json/, 'the row names the unreadable record so it can be diagnosed')

  const single = await jsonRequest(`/api/sessions/${cid}`)
  assert.equal(single.status, 200, 'the per-session read reports the corrupt row rather than 404 "no such session"')

  // no writer may repair it: the lifecycle hooks' writers and a typed declaration must all refuse
  for (const argv of [
    ['internal', 'session-state', 'active', '--session', cid],
    ['internal', 'session-idle', '--session', cid],
    ['session', 'ask', '--note', 'still alive', '--session', cid],
  ]) {
    await spex(worktree, ...argv).catch(() => '')
    assert.equal(readFileSync(rec, 'utf8'), original, `\`spex ${argv.join(' ')}\` left the corrupt record byte-identical`)
  }

  const quarantineBefore = quarantineFiles(home).length
  const stopped = await jsonRequest(`/api/sessions/${cid}/stop`, { method: 'POST' })
  assert.equal(stopped.status, 409, `corrupt stop with an unowned loaded thread fails closed: ${stopped.text}`)
  assert.match(String(stopped.body?.error ?? stopped.text), /loaded thread.*without one exact governed session owner/is)
  assert.equal((await pexec('tmux', ['-L', tmux!, 'display-message', '-p', '-t', cid, '#{pane_pid}'])).stdout.trim(), paneBefore, 'stop sent no tmux signal')
  assert.equal(processStartToken(agent.pid!), agentStart, 'stop left the exact signalable agent instance alive')
  assert.equal(readFileSync(adapterTransport, 'utf8'), 'must survive without guessed defaultHarness cleanup\n', 'stop ran no guessed adapter cleanup')
  assert.equal(quarantineFiles(home).length, quarantineBefore, 'stop does not mutate control-plane evidence')

  const closed = await jsonRequest(`/api/sessions/${cid}/close`, { method: 'POST' })
  assert.equal(closed.status, 409, `a corrupt record close fails closed: ${closed.text}`)
  assert.match(String(closed.body?.error ?? closed.text), /unreadable record.*no adapter.*loaded thread.*runtime remains.*worktree.*branch.*no process signal or deletion/is)
  assert.equal(readFileSync(rec, 'utf8'), original, 'the corrupt record remains byte-identical')
  assert.equal(readFileSync(runtimeSentinel, 'utf8'), 'must survive corrupt close\n', 'session runtime remains')
  assert.equal(readFileSync(join(preservedWorktree, 'unmerged.txt'), 'utf8'), 'must survive corrupt close\n', 'worktree bytes remain')
  await pexec('git', ['-C', worktree, 'show-ref', '--verify', `refs/heads/${preservedBranch}`])
  const paneAfter = (await pexec('tmux', ['-L', tmux!, 'display-message', '-p', '-t', cid, '#{pane_pid}'])).stdout.trim()
  assert.equal(paneAfter, paneBefore, 'close sent no signal to the exact tmux leaf')
  assert.equal(processStartToken(agent.pid!), agentStart, 'close left the exact signalable agent instance alive')
  assert.equal(readFileSync(adapterTransport, 'utf8'), 'must survive without guessed defaultHarness cleanup\n', 'close ran no guessed adapter cleanup')
  const quarantined = quarantineFiles(home)
  assert.ok(quarantined.some((f) => readFileSync(f, 'utf8') === original),
    `the original bytes are copied to control-plane evidence (found: ${quarantined.join(', ') || 'nothing'})`)
  assert.equal((await jsonRequest(`/api/sessions/${cid}`)).body?.status, 'corrupt', 'the preserved corrupt row remains visible')
  await stopSharedRuntime()
  await pexec('tmux', ['-L', tmux!, 'kill-session', '-t', cid])
  cleanupAgent()
  process.removeListener('exit', cleanupAgent)
  for (let i = 0; i < 50 && processStartToken(agent.pid!) === agentStart; i++) await sleep(20)
  assert.notEqual(processStartToken(agent.pid!), agentStart, 'fixture teardown removed only its exact agent instance')
  const absentClose = await jsonRequest(`/api/sessions/${cid}/close`, { method: 'POST' })
  assert.equal(absentClose.status, 409, `target-absent corrupt close remains quarantine-only: ${absentClose.text}`)
  assert.match(String(absentClose.body?.error ?? absentClose.text), /could not prove its live references.*Runtime remains/is)
  assert.equal(readFileSync(rec, 'utf8'), original, 'target-absent close still preserves the corrupt runtime')
  assert.equal(readFileSync(join(preservedWorktree, 'unmerged.txt'), 'utf8'), 'must survive corrupt close\n', 'target-absent close preserves worktree bytes')
  await pexec('git', ['-C', worktree, 'show-ref', '--verify', `refs/heads/${preservedBranch}`])
  assert.equal(readFileSync(adapterTransport, 'utf8'), 'must survive without guessed defaultHarness cleanup\n', 'target-absent close runs no adapter cleanup')
  await pexec('git', ['-C', worktree, 'branch', '-D', preservedBranch])
  rmSync(preservedWorktree, { recursive: true, force: true })
  rmSync(dirname(rec), { recursive: true, force: true })
  rmSync(adapterTransport, { force: true })
  console.log(`PASS: corrupt close quarantines evidence, fails loud, and preserves every unowned residue (${cid})`)
}

function quarantineFiles(home: string): string[] {
  const roots = readdirSync(join(home, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory())
  const out: string[] = []
  for (const r of roots) {
    const dir = join(home, 'projects', r.name, 'corrupt')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) out.push(join(dir, f))
  }
  return out
}

async function duplicateLoadedThreadIsBlocked(home: string, project: string): Promise<void> {
  const first = '00000000-0000-4000-8000-0000d001ca7e'
  const second = '00000000-0000-4000-8000-0000d002ca7e'
  const thread = 'thread-with-two-readable-records'
  const parent = dirname(project)
  const worktrees = new Map([[first, join(parent, `duplicate-owner-a-${process.pid}`)], [second, join(parent, `duplicate-owner-b-${process.pid}`)]])
  const branches = new Map([[first, `node/duplicate-owner-a-${process.pid}`], [second, `node/duplicate-owner-b-${process.pid}`]])
  const record = (id: string) => ({
    session_id: id,
    governed: true,
    worktree_path: worktrees.get(id),
    branch: branches.get(id),
    node: '', title: '', name: '', parent: '',
    status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(),
    harness: 'codex', harness_session_id: thread, stopped: false, archived: false,
    launcher: 'codex', launch_cmd: 'codex --yolo', launch_owner: '',
  })
  for (const id of [first, second]) {
    await pexec('git', ['-C', project, 'worktree', 'add', '-q', '-b', branches.get(id)!, worktrees.get(id)!])
    const path = await recordPath(home, project, id)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(record(id), null, 2)}\n`)
  }
  const tmux = process.env.SPEXCODE_TMUX!
  await pexec('tmux', ['-L', tmux, 'new-session', '-d', '-s', first, 'sleep 300'])
  const pane = (await pexec('tmux', ['-L', tmux, 'display-message', '-p', '-t', first, '#{pane_pid}'])).stdout.trim()
  const stopSharedRuntime = await fakeLoadedThreadRuntime(thread)
  try {
    const stopped = await jsonRequest(`/api/sessions/${first}/stop`, { method: 'POST' })
    assert.equal(stopped.status, 409, `ambiguous loaded-thread stop fails closed: ${stopped.text}`)
    assert.match(String(stopped.body?.error ?? stopped.text), /without one exact governed session owner.*thread-with-two-readable-records/is)
    assert.equal((await pexec('tmux', ['-L', tmux, 'display-message', '-p', '-t', first, '#{pane_pid}'])).stdout.trim(), pane, 'ambiguous stop sent no tmux signal')

    const closed = await jsonRequest(`/api/sessions/${first}/close`, { method: 'POST' })
    assert.equal(closed.status, 409, `ambiguous loaded-thread close fails closed: ${closed.text}`)
    assert.match(String(closed.body?.error ?? closed.text), /without one exact governed session owner.*thread-with-two-readable-records/is)
    assert.equal((await pexec('tmux', ['-L', tmux, 'display-message', '-p', '-t', first, '#{pane_pid}'])).stdout.trim(), pane, 'ambiguous close sent no tmux signal')
    for (const id of [first, second]) {
      assert.ok(existsSync(worktrees.get(id)!), `ambiguous close preserved worktree ${id}`)
      await pexec('git', ['-C', project, 'show-ref', '--verify', `refs/heads/${branches.get(id)}`])
      assert.ok(existsSync(await recordPath(home, project, id)), `ambiguous close preserved runtime record ${id}`)
    }
  } finally {
    await stopSharedRuntime()
    await pexec('tmux', ['-L', tmux, 'kill-session', '-t', first]).catch(() => null)
    for (const id of [first, second]) {
      await pexec('git', ['-C', project, 'worktree', 'remove', '--force', worktrees.get(id)!]).catch(() => null)
      await pexec('git', ['-C', project, 'branch', '-D', branches.get(id)!]).catch(() => null)
      rmSync(dirname(await recordPath(home, project, id)), { recursive: true, force: true })
    }
  }
  console.log(`PASS: duplicate records for one loaded thread block public stop and close without signals or deletion (${thread})`)
}

// ---- phase 3: a session whose work merged and whose worktree AND branch are both gone ----------------
// Nothing may bring it back: not the hooks' state writers, not resume. The reported failure had a hook
// rewrite a retired session into a fresh `idle` record and regenerate a launch script for it.
async function retiredSessionNeverRevives(home: string, project: string): Promise<void> {
  const created = await createSession()
  const id = created.id
  const rec = await recordPath(home, project, id)
  await waitFor(async () => (await readSession(id)).liveness, (v) => v === 'online', 'second worker online')
  await jsonRequest(`/api/sessions/${id}/stop`, { method: 'POST' })
  // manual retirement: the work merged, the human removed the worktree and the branch, the record stayed
  await pexec('git', ['-C', project, 'worktree', 'remove', '--force', created.path])
  if (created.branch) await pexec('git', ['-C', project, 'branch', '-D', created.branch])
  assert.equal(existsSync(created.path), false, 'the worktree is gone')

  // the retired record is frozen: a writer may neither move its lifecycle nor rewrite it into a fresh shell,
  // and it must say WHY rather than silently no-op.
  const frozen = readFileSync(rec, 'utf8')
  for (const argv of [
    ['internal', 'session-state', 'active', '--session', id],
    ['internal', 'session-idle', '--session', id],
    ['session', 'ask', '--note', 'back from the dead', '--session', id],
  ]) {
    const said = await spex(project, ...argv).catch((e) => String(e))
    assert.equal(readFileSync(rec, 'utf8'), frozen, `\`spex ${argv.join(' ')}\` rewrote a retired session's record; it said: ${said.trim()}`)
    assert.match(said, /retired/i, `\`spex ${argv.join(' ')}\` must say the session is retired, not no-op silently (said: ${said.trim()})`)
  }

  const row = await readSession(id)
  assert.equal(row.status, 'retired', 'the retired session reads as retired on the list')

  // the launch script from the original launch is still on disk; what must not happen is resume REWRITING it
  // (and then running it) against a worktree that is gone.
  const script = join(dirname(rec), 'launch.sh')
  const before = existsSync(script) ? statSync(script).mtimeMs : null
  const resumed = await jsonRequest(`/api/sessions/${id}/resume`, { method: 'POST' })
  assert.ok(resumed.status >= 400, `resume refuses a retired session: ${resumed.status} ${resumed.text}`)
  assert.match(String(resumed.body?.error ?? resumed.text), /retired|worktree/i, 'the refusal names the reason')
  assert.equal(existsSync(script) ? statSync(script).mtimeMs : null, before, 'resume regenerated no launch script for a retired session')
  assert.equal(readFileSync(rec, 'utf8'), frozen, 'the refused resume left the record untouched')

  const closed = await jsonRequest(`/api/sessions/${id}/close`, { method: 'POST' })
  assert.equal(closed.status, 200, `a retired session is still closable: ${closed.text}`)
  console.log(`PASS: a retired session refuses every revival path and stays closable (${id})`)
}

// PHASE selects one scenario's measurement (`notes` | `corrupt` | `retired`), so each scenario files its own
// transcript; unset runs all three in one pass, which is the regression form.
const PHASE = process.env.PHASE || 'all'
const runs = (name: string): boolean => PHASE === 'all' || PHASE === name

// ---- phase 1: a note carrying every character that breaks string-assembled JSON ----------------------
async function notesRoundTrip(home: string): Promise<void> {
  const created = await createSession()
  const id = created.id
  const rec = await recordPath(home, created.path, id)
  const readRaw = (): string => readFileSync(rec, 'utf8')
  const parses = (): boolean => { try { JSON.parse(readRaw()); return true } catch { return false } }
  try {
    await waitFor(async () => (await readSession(id)).liveness, (v) => v === 'online', 'fake worker online')
    assert.ok(existsSync(rec), 'the governed record exists in the global store')

    // ---- entry 1: the PROPOSAL note, written by the real CLI declaration verb -------------------------
    await spex(created.path, 'session', 'done', '--propose', 'merge', '--note', NASTY, '--session', id)
    assert.ok(parses(), `after a proposal note the record is still valid JSON:\n${readRaw()}`)
    let session = await readSession(id)
    assert.equal(session.note, NASTY, 'the proposal note round-trips through the backend read route verbatim')
    assert.equal(session.status, 'review', 'the proposal is a review')

    // ---- the hot-path hook must not damage a note it did not write -----------------------------------
    // Every subsequent tool call fires mark-active over that record. It is the ONE writer that used to
    // assemble JSON in shell, so this is where a correctly-written note was destroyed.
    await fireHook(created.path, 'PreToolUse', {
      session_id: id, tool_name: 'Read', tool_input: { file_path: join(created.path, 'README.md') },
    })
    assert.ok(parses(), `after the hot-path hook the record is STILL valid JSON:\n${readRaw()}`)
    session = await readSession(id)
    assert.equal(session.id, id, 'the session is still readable after the hook (never "no session record")')
    assert.equal(session.note, null, 'the hook cleared the now-stale note')
    assert.equal(session.lifecycle, 'active', 'the hook flipped the record back to active')

    // ---- entry 2: the ASKING note, written from the hook payload itself ------------------------------
    await fireHook(created.path, 'PreToolUse', {
      session_id: id, tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: NASTY }] },
    })
    assert.ok(parses(), `after an asking note the record is still valid JSON:\n${readRaw()}`)
    session = await readSession(id)
    assert.equal(session.lifecycle, 'asking', 'the ask payload became the asking lifecycle')
    assert.equal(session.note, NASTY, 'the asking note round-trips verbatim, quote/backslash/newline/unicode intact')

    // ---- entry 3: the same note through the typed ask verb, then read by a fresh CLI process ----------
    await spex(created.path, 'session', 'ask', '--note', NASTY, '--session', id)
    assert.ok(parses(), 'after the typed ask verb the record is still valid JSON')
    const listed = JSON.parse(await spex(created.path, 'session', 'ls', '--json'))
    const row = listed.find((s: any) => s.id === id)
    assert.ok(row, 'a fresh CLI process still lists the session (the record survives a reader restart)')
    assert.equal(row.note, NASTY, 'the note is verbatim to a fresh reader process too')

    // ---- the REAL trigger text, straight through the write path --------------------------------------
    await spex(created.path, 'session', 'park', '--note', REAL_TRIGGER, '--session', id)
    assert.ok(parses(), `the incident's own trigger string leaves a parseable record:\n${readRaw()}`)
    assert.equal((await readSession(id)).note, REAL_TRIGGER, 'the trigger string round-trips verbatim')

    // ---- the review payload (the manager's read surface) also survives --------------------------------
    const review = await jsonRequest(`/api/sessions/${id}/review`)
    assert.equal(review.status, 200, `review payload readable: ${review.text}`)

    console.log(`PASS: proposal + asking notes round-trip verbatim through CLI, hook, and backend; record stayed parseable (${id})`)
  } finally {
    await jsonRequest(`/api/sessions/${id}/close`, { method: 'POST' }).catch(() => null)
  }
}

// ---- phase 4: the ordinary path must not have regressed ---------------------------------------------
// Everything above is about launches and writers that must be REFUSED. This is the other half of the same
// claim: a healthy session still stops and resumes through the real routes, comes back online, and rests at
// `idle` — the new preflight and the launch script's stderr capture change nothing for a launch that works.
async function ordinaryStopResumeStillWorks(home: string): Promise<void> {
  const created = await createSession()
  const id = created.id
  const rec = await recordPath(home, created.path, id)
  try {
    await waitFor(async () => (await readSession(id)).liveness, (v) => v === 'online', 'worker online before stop')
    const stopped = await jsonRequest(`/api/sessions/${id}/stop`, { method: 'POST' })
    assert.equal(stopped.status, 200, `stop: ${stopped.text}`)
    await waitFor(async () => (await readSession(id)).liveness, (v) => v === 'offline', 'worker offline after stop')

    const resumed = await jsonRequest(`/api/sessions/${id}/resume`, { method: 'POST' })
    assert.equal(resumed.status, 200, `a healthy offline session still resumes: ${resumed.text}`)
    await waitFor(async () => (await readSession(id)).liveness, (v) => v === 'online', 'worker back online after resume')
    const row = await readSession(id)
    assert.equal(row.status, 'idle', 'a resumed session rests at idle, never a phantom working')
    assert.ok(JSON.parse(readFileSync(rec, 'utf8')).session_id === id, 'the record is still parseable after the whole cycle')
    console.log(`PASS: an ordinary session still stops, resumes into the same conversation, and rests idle (${id})`)
  } finally {
    await jsonRequest(`/api/sessions/${id}/close`, { method: 'POST' }).catch(() => null)
  }
}

async function main(): Promise<void> {
  const home = process.env.SPEXCODE_HOME
  assert.ok(home, 'SPEXCODE_HOME must point at the fixture store')
  assert.equal((await fetch(`${BASE}/health`)).status, 200, 'backend health')
  const project = process.cwd()

  if (runs('notes')) await notesRoundTrip(home!)
  if (runs('corrupt')) {
    await corruptRecordIsDiagnosable(home!, project)
    await duplicateLoadedThreadIsBlocked(home!, project)
  }
  if (runs('retired')) await retiredSessionNeverRevives(home!, project)
  if (runs('resume')) await ordinaryStopResumeStillWorks(home!)
  // one summary line whatever ran, so a single-phase measurement is as self-contained as the whole regression.
  console.log(`PASS: session record integrity — ${PHASE === 'all' ? 'notes round-trip, corrupt is diagnosable, retired never revives, ordinary resume intact' : PHASE}`)
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
