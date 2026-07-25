// No-model product fixture for session-record INTEGRITY: every note-carrying declaration entry must survive a
// full round trip through the real product surfaces — the real CLI declaration verbs, the real hook dispatcher,
// the real backend read routes — with a note carrying the characters that break string-assembled JSON.
// Run against a backend whose claude launcher resolves to spec-cli/test/fixtures/fake-claude:
//   BASE=http://127.0.0.1:8787 npx tsx test/session-record-integrity-fixture.ts
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
// "no session record"), it must never be silently repaired into a valid empty record by a hook, and it
// must stay closable with its original bytes kept as evidence.
async function corruptRecordIsDiagnosable(home: string, worktree: string): Promise<void> {
  const cid = '11111111-1111-1111-1111-111111111111'
  const rec = await recordPath(home, worktree, cid)
  mkdirSync(dirname(rec), { recursive: true })
  // the exact shape shell value-substitution produced: a note whose escaped quote was cut mid-string
  writeFileSync(rec, [
    '{', `  "session_id": "${cid}",`, '  "governed": true,', `  "worktree_path": "${worktree}",`,
    '  "branch": "node/corrupt-1111",', '  "node": "",', '  "title": "corrupt fixture",', '  "name": "",',
    '  "parent": "",', '  "status": "asking",', '  "proposal": "",', '  "merges": 0,',
    '  "note": ""hi" and \\ then",', '  "sortkey": "",', '  "createdAt": 1784900000000,',
    '  "harness": "claude",', '  "harness_session_id": "",', '  "stopped": false,', '  "archived": false,',
    '  "launcher": "fake",', '  "launch_cmd": "/bin/true",', '  "launch_owner": ""', '}', '',
  ].join('\n'))
  const original = readFileSync(rec, 'utf8')
  assert.throws(() => JSON.parse(original), 'the planted record really is unparseable')

  const rows = (await jsonRequest('/api/sessions')).body as any[]
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

  const closed = await jsonRequest(`/api/sessions/${cid}/close`, { method: 'POST' })
  assert.equal(closed.status, 200, `a corrupt record is still closable: ${closed.text}`)
  assert.equal(closed.body?.ok, true, 'close reports success on a corrupt record')
  assert.equal(existsSync(rec), false, 'close swept the session dir')
  const quarantined = quarantineFiles(home)
  assert.ok(quarantined.some((f) => readFileSync(f, 'utf8') === original),
    `the original bytes are preserved as evidence outside the swept dir (found: ${quarantined.join(', ') || 'nothing'})`)
  console.log(`PASS: a corrupt record stays visible, refuses every writer, closes, and leaves its bytes as evidence (${cid})`)
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

    // ---- the review payload (the manager's read surface) also survives --------------------------------
    const review = await jsonRequest(`/api/sessions/${id}/review`)
    assert.equal(review.status, 200, `review payload readable: ${review.text}`)

    console.log(`PASS: proposal + asking notes round-trip verbatim through CLI, hook, and backend; record stayed parseable (${id})`)
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
  if (runs('corrupt')) await corruptRecordIsDiagnosable(home!, project)
  if (runs('retired')) await retiredSessionNeverRevives(home!, project)
  if (PHASE === 'all') console.log('PASS: session record integrity — notes round-trip, corrupt is diagnosable, retired never revives')
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
