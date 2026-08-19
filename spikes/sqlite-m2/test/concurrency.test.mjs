// Real OS processes against one absolute database path. These are the claims that cannot be proved
// inside one process: the first-open migration race, and enqueue_seq never becoming visible out of
// commit order (which is what makes a cursor safe and what BEGIN IMMEDIATE actually buys).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const { openProtocol } = await import(process.env.M2_ENGINE || '../engine.mjs')

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
  const deadline = startAt + 4000
  const results = await runWorkers([
    ...Array.from({ length: WRITERS }, (_, i) => [path, 'enqueue', startAt, 'load', PER_WRITER, 'w' + i]),
    [path, 'follow', startAt, 'load', deadline],
  ])
  for (const r of results) assert.equal(r.parsed?.ok, true, `${r.out}${r.err}`)

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
  const deadline = startAt + 3000
  const results = await runWorkers(Array.from({ length: 4 }, () => [path, 'drain', startAt, 'shared', deadline]))
  for (const r of results) assert.equal(r.parsed?.ok, true, `${r.out}${r.err}`)
  const taken = results.flatMap(r => r.parsed.taken)
  assert.equal(taken.length, new Set(taken).size, 'no message was dequeued twice')
  assert.deepEqual(taken.slice().sort(), expected.slice().sort(), 'every message was delivered exactly once')

  const handle = openProtocol(path)
  assert.deepEqual(handle.listPending('shared'), [])
  handle.close()
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
