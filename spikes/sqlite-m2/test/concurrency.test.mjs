// Real OS processes against one absolute database path. These are the claims that cannot be proved
// inside one process: the first-open migration race, and enqueue_seq never becoming visible out of
// commit order (which is what makes a cursor safe and what BEGIN IMMEDIATE actually buys).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const { openProtocol } = await import(process.env.M2_ENGINE || '../engine.mjs')

const body = t => Buffer.from(t, 'utf8')
const msg = (over = {}) => ({ kind: 'test.v1', body: body('hello'), ...over })

const WORKER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'worker.mjs')
const roots = []
const freshDb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-conc-'))
  roots.push(dir)
  return join(dir, 'protocol.sqlite')
}
process.on('exit', () => { for (const r of roots) { try { rmSync(r, { recursive: true, force: true }) } catch {} } })

const runWorkers = specs => Promise.all(specs.map(args => new Promise(resolve => {
  const engine = process.env.M2_ENGINE ? { M2_ENGINE: process.env.M2_ENGINE.replace(/^\.\./, '.') } : {}
  const child = spawn(process.execPath, [WORKER, ...args.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...engine },
  })
  let out = ''
  let err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { err += d })
  child.on('close', code => {
    let parsed = null
    try { parsed = JSON.parse(out.trim().split('\n').pop()) } catch {}
    resolve({ code, parsed, out, err })
  })
})))

test('eight processes opening one fresh database migrate it exactly once', async () => {
  const path = freshDb()
  const startAt = Date.now() + 400
  const results = await runWorkers(Array.from({ length: 8 }, () => [path, 'open', startAt]))
  for (const r of results) {
    assert.equal(r.code, 0, `worker failed: ${r.out}${r.err}`)
    assert.equal(r.parsed?.ok, true, JSON.stringify(r.parsed))
  }
  const raw = new DatabaseSync(path)
  const rows = raw.prepare("SELECT version, count(*) AS c FROM schema_migrations WHERE component='session-protocol' GROUP BY version").all()
  raw.close()
  assert.deepEqual(rows.map(r => ({ version: Number(r.version), c: Number(r.c) })), [{ version: 1, c: 1 }])
})

test('repeated cold opens by eight processes never lose the first-open race', async () => {
  const ROUNDS = Number(process.env.M2_COLD_OPEN_ROUNDS ?? 10)
  const failures = []
  for (let round = 0; round < ROUNDS; round++) {
    const path = freshDb()
    const startAt = Date.now() + 250
    const results = await runWorkers(Array.from({ length: 8 }, () => [path, 'open', startAt]))
    for (const r of results) if (r.parsed?.ok !== true) failures.push({ round, parsed: r.parsed, err: r.err })
  }
  assert.deepEqual(failures, [], `cold-open race lost in ${failures.length}/${ROUNDS * 8} opens`)
})

test('eight processes racing initialize on one address converge without duplication', async () => {
  const path = freshDb()
  openProtocol(path).close()
  const startAt = Date.now() + 400
  const results = await runWorkers(Array.from({ length: 8 }, () => [path, 'initialize', startAt, 'racer']))
  for (const r of results) assert.equal(r.parsed?.ok, true, `${r.out}${r.err}`)
  const created = new Set(results.map(r => r.parsed.result.createdAtMs))
  assert.equal(created.size, 1, 'every process agreed on one creation instant')
  const handle = openProtocol(path)
  assert.equal(handle.counts().sessions, 1)
  handle.close()
})

test('a cursor following concurrent writers never skips a committed message', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('load')
  setup.close()

  const WRITERS = 6
  const PER_WRITER = 120
  const startAt = Date.now() + 500
  const deadline = startAt + 60000
  const results = await runWorkers([
    ...Array.from({ length: WRITERS }, (_, i) => [path, 'enqueue', startAt, 'load', PER_WRITER, 'w' + i]),
    [path, 'follow', startAt, 'load', WRITERS * PER_WRITER, deadline],
  ])
  for (const r of results) assert.equal(r.parsed?.ok, true, `${r.out}${r.err}`)
  const follower = results.find(r => r.parsed.op === 'follow')
  assert.equal(follower.parsed.complete, true,
    'the follower must reach the expected count, or this vector proves nothing about skipping')

  const written = results.filter(r => r.parsed.op === 'enqueue').flatMap(r => r.parsed.ids)
  const followed = results.find(r => r.parsed.op === 'follow').parsed.seen
  assert.equal(written.length, WRITERS * PER_WRITER)
  assert.equal(new Set(written).size, written.length, 'no duplicate message ids across processes')
  assert.equal(followed.length, new Set(followed).size, 'the follower saw nothing twice')
  assert.deepEqual(
    written.slice().sort(),
    followed.slice().sort(),
    'a cursor advanced during concurrent commits still observed every message exactly once',
  )
})

test('concurrent consumers of one queue split it without a double dequeue', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('shared')
  const expected = []
  for (let i = 0; i < 300; i++) expected.push(setup.enqueue('shared', { kind: 'x.v1', body: Buffer.from(String(i)) }).messageId)
  setup.close()

  const startAt = Date.now() + 300
  const deadline = startAt + 60000
  const results = await runWorkers(Array.from({ length: 4 }, () => [path, 'drain', startAt, 'shared', deadline]))
  for (const r of results) assert.equal(r.parsed?.ok, true, `${r.out}${r.err}`)
  for (const r of results) {
    assert.equal(r.parsed.drained, true,
      'every consumer must have reached an empty queue, or this vector proves nothing about duplication')
  }
  const taken = results.flatMap(r => r.parsed.taken)
  assert.equal(taken.length, new Set(taken).size, 'no message was dequeued twice')
  assert.deepEqual(taken.slice().sort(), expected.slice().sort(), 'every message was delivered exactly once')

  const handle = openProtocol(path)
  assert.deepEqual(handle.listPending('shared'), [])
  handle.close()
})

// Spawns a worker, waits for its own readiness line, then SIGKILLs it. Waiting on the worker's
// signal rather than a sleep is what makes this a crash test and not a race with process startup.
const killAfterSignal = (args, signalText) => new Promise((resolve, reject) => {
  const engine = process.env.M2_ENGINE ? { M2_ENGINE: process.env.M2_ENGINE.replace(/^\.\./, '.') } : {}
  const child = spawn(process.execPath, [WORKER, ...args.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...engine },
  })
  let out = ''
  let err = ''
  child.stdout.on('data', d => {
    out += d
    if (out.includes(signalText)) { child.kill('SIGKILL'); resolve(out.trim()) }
  })
  child.stderr.on('data', d => { err += d })
  child.on('close', () => reject(new Error(`worker exited before "${signalText}": ${out}${err}`)))
})

// Starts a worker and resolves once it prints its own readiness line, WITHOUT killing it. The
// caller gets the child so it can be reaped after the window it owns.
const startAndWait = (args, signalText) => new Promise((resolve, reject) => {
  const engine = process.env.M2_ENGINE ? { M2_ENGINE: process.env.M2_ENGINE.replace(/^\.\./, '.') } : {}
  const child = spawn(process.execPath, [WORKER, ...args.map(String)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...engine },
  })
  let out = ''
  let err = ''
  child.stdout.on('data', d => { out += d; if (out.includes(signalText)) resolve(child) })
  child.stderr.on('data', d => { err += d })
  child.on('close', () => reject(new Error(`worker exited before "${signalText}": ${out}${err}`)))
})

test('busy_timeout must be the connection\'s first statement, or the version probe has no budget', async () => {
  // The ordering claim used to be gated only by a cold-open race between eight processes, which is
  // inherently probabilistic: it caught a wrong-ordered engine sometimes and not others, so it was
  // not a gate. This holds the lock deterministically instead, and separates the two orderings by
  // pass/fail rather than by luck.
  //
  //   lock holder     a second OS process, PRAGMA locking_mode=EXCLUSIVE, holds after COMMIT
  //   hold window     1500 ms, released by the holder itself, not by a kill
  //   short budget    200 ms  -> expect PROTOCOL_DATABASE_BUSY even when correctly ordered
  //   long budget     8000 ms -> expect success, after waiting out the holder
  //
  // Correct order sets busy_timeout before the first database-touching statement, so the probe
  // blocks and then succeeds. Wrong order runs the probe while busy_timeout is still its default 0,
  // so it is refused immediately and open fails.
  const HOLD_MS = 1500
  const SHORT_BUDGET_MS = 200
  const LONG_BUDGET_MS = 8000

  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('gate')
  setup.close()

  const holder = await startAndWait([path, 'lock-holder', 0, HOLD_MS], 'held')
  try {
    // Control: proves the lock is genuinely held, so a later success cannot be a false pass.
    const shortStart = Date.now()
    let shortCode = null
    try { openProtocol(path, { busyTimeoutMs: SHORT_BUDGET_MS }).close() } catch (error) { shortCode = error.code }
    const shortElapsed = Date.now() - shortStart
    assert.equal(shortCode, 'PROTOCOL_DATABASE_BUSY',
      `a budget shorter than the hold must be refused; if this passes the holder is not holding (${shortElapsed}ms)`)

    // The discriminating assertion. A wrong-ordered engine fails here with PROTOCOL_DATABASE_BUSY,
    // because its probe ran with no busy handler at all.
    const longStart = Date.now()
    let handle = null
    let longCode = null
    try { handle = openProtocol(path, { busyTimeoutMs: LONG_BUDGET_MS }) } catch (error) { longCode = error.code }
    const longElapsed = Date.now() - longStart
    assert.equal(longCode, null,
      `open with a ${LONG_BUDGET_MS}ms budget must wait out a ${HOLD_MS}ms hold, got ${longCode} after ${longElapsed}ms`)
    assert.ok(longElapsed >= HOLD_MS * 0.4,
      `open returned in ${longElapsed}ms, too fast to have waited for the holder — the budget was not in effect`)
    assert.equal(handle.listPending('gate').length, 0)
    handle.close()
  } finally {
    holder.kill('SIGKILL')
  }
})

test('SIGKILL before commit leaves the message pending and the rollback journal is recovered', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('crash')
  setup.close()

  await killAfterSignal([path, 'crash-precommit', 0, 'crash'], 'staged')
  const dir = dirname(path)
  const sidecarsAfterKill = readdirSync(dir).filter(f => f !== 'protocol.sqlite').sort()
  assert.deepEqual(sidecarsAfterKill, ['protocol.sqlite-journal'],
    'a killed writer leaves its rollback journal behind — that is the recovery record')

  // Correctness first: the uncommitted enqueue must be invisible to every later reader, whether or
  // not the journal file has been cleaned up yet.
  const readOnly = openProtocol(path, { readOnly: true })
  assert.deepEqual(readOnly.listPending('crash'), [], 'a read-only reader never sees the staged write')
  readOnly.close()

  const after = openProtocol(path)
  assert.deepEqual(after.listPending('crash'), [], 'the uncommitted enqueue was rolled back')
  assert.equal(after.counts().messages, 0)

  // Measured: the hot journal is consumed by the next WRITE, not by an open or a read. A lingering
  // -journal is therefore not an error state and must never be read as data or as pending recovery.
  assert.deepEqual(readdirSync(dir).filter(f => f !== 'protocol.sqlite'), ['protocol.sqlite-journal'],
    'reads leave the journal in place')
  after.enqueue('crash', msg({ body: body('after-recovery') }))
  assert.deepEqual(readdirSync(dir).filter(f => f !== 'protocol.sqlite'), [],
    'the first write consumes the rollback journal')
  assert.equal(after.counts().messages, 1, 'only the post-recovery message exists')
  after.close()
})

test('a handler that dies after dequeue never makes the message reappear', async () => {
  // The M3 decision, as a fixture: v1 does NOT put the consumer handler journal inside the protocol and
  // does NOT bind it to the dequeue transaction. So a consumer that commits a dequeue and then dies
  // before its downstream effect loses that effect -- the protocol will not hand the message out again.
  // Anything claiming protocol-level at-least-once would have to make this vector fail.
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('handler')
  const staged = setup.enqueue('handler', { kind: 'handler.v1', body: Buffer.from('exactly once') })
  setup.close()

  const out = await killAfterSignal([path, 'crash-handler', 0, 'handler'], 'dequeued')
  assert.equal(out.split(/\s+/).pop(), staged.messageId, 'the handler really did take this message')

  const after = openProtocol(path)
  assert.deepEqual(after.listPending('handler'), [], 'a dead handler does not requeue committed delivery')
  assert.equal(after.dequeue('handler'), null, 'there is no protocol-level at-least-once to fall back on')
  const history = after.readMessages('handler')
  assert.equal(history.length, 1, 'history keeps the message')
  assert.ok(history[0].dequeuedAtMs !== null, 'and still records it as dequeued')
  after.close()
})

test('SIGKILL after commit keeps the message and never requeues it', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('crash')
  setup.close()

  const out = await killAfterSignal([path, 'crash-postcommit', 0, 'crash'], 'committed')
  const committedId = out.split(/\s+/).pop()

  const after = openProtocol(path)
  const pending = after.listPending('crash')
  assert.equal(pending.length, 1, 'the committed message survived the kill')
  assert.equal(pending[0].messageId, committedId)
  const taken = after.dequeue('crash')
  assert.equal(taken.messageId, committedId)
  assert.equal(after.dequeue('crash'), null, 'a post-commit kill does not duplicate the message')
  after.close()
})

test('short writes stay bounded: the write lock holds only SQL', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.initialize('bench')
  const payload = Buffer.alloc(100, 1)
  const durations = []
  const started = Date.now()
  const benchMs = Number(process.env.M2_BENCH_MS ?? 10000)
  let count = 0
  while (Date.now() - started < benchMs && count < 5000) {
    const t = process.hrtime.bigint()
    handle.enqueue('bench', { kind: 'bench.v1', body: payload })
    durations.push(Number(process.hrtime.bigint() - t) / 1e6)
    count++
  }
  const elapsed = (Date.now() - started) / 1000
  durations.sort((a, b) => a - b)
  const p99 = durations[Math.floor(durations.length * 0.99)]
  console.log(`    ${count} enqueues in ${elapsed.toFixed(2)}s = ${(count / elapsed).toFixed(0)}/s, p50=${durations[Math.floor(durations.length / 2)].toFixed(3)}ms p99=${p99.toFixed(3)}ms`)
  if (benchMs >= 10000) assert.ok(count >= 500, `roadmap M2 exit wants at least 500 short writes in 10s, got ${count}`)
  assert.equal(handle.counts().messages, count)
  handle.close()
})
