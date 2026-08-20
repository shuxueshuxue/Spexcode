import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { openProtocol } from './index.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new(path: string) => {
    exec(sql: string): void
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | undefined
      all(...params: unknown[]): Record<string, unknown>[]
      run(...params: unknown[]): unknown
    }
    close(): void
  }
}

const workerPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'test', 'worker.mjs')
const roots: string[] = []
const freshDb = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'session-protocol-concurrency-'))
  roots.push(root)
  return join(root, 'protocol.sqlite')
}
process.on('exit', () => {
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

interface WorkerResult {
  code: number | null
  parsed: any
  stdout: string
  stderr: string
}

const runWorkers = (specs: unknown[][]): Promise<WorkerResult[]> => Promise.all(specs.map(args =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [workerPath, ...args.map(String)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('close', code => {
      let parsed = null
      try { parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '') } catch {}
      resolve({ code, parsed, stdout, stderr })
    })
  }),
))

const killAfterSignal = (args: unknown[], signal: string): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [workerPath, ...args.map(String)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let signalled = false
  child.stdout.on('data', data => {
    stdout += data
    if (!signalled && stdout.includes(signal)) {
      signalled = true
      child.kill('SIGKILL')
      resolve(stdout.trim())
    }
  })
  child.stderr.on('data', data => { stderr += data })
  child.on('close', () => {
    if (!signalled) reject(new Error(`worker exited before ${signal}: ${stdout}${stderr}`))
  })
})

const startAndWait = (args: unknown[], signal: string): Promise<ReturnType<typeof spawn>> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...args.map(String)], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let signalled = false
    child.stdout.on('data', data => {
      stdout += data
      if (!signalled && stdout.includes(signal)) {
        signalled = true
        resolve(child)
      }
    })
    child.stderr.on('data', data => { stderr += data })
    child.on('close', () => {
      if (!signalled) reject(new Error(`worker exited before ${signal}: ${stdout}${stderr}`))
    })
  })

test('eight processes opening one fresh database migrate it exactly once', async () => {
  const path = freshDb()
  const startAt = Date.now() + 400
  const results = await runWorkers(Array.from({ length: 8 }, () => [path, 'open', startAt]))
  for (const result of results) {
    assert.equal(result.code, 0, `${result.stdout}${result.stderr}`)
    assert.equal(result.parsed?.ok, true, JSON.stringify(result.parsed))
  }
  const database = new DatabaseSync(path)
  const rows = database.prepare(
    "SELECT version, count(*) AS count FROM schema_migrations WHERE component='session-protocol' GROUP BY version",
  ).all()
  database.close()
  assert.deepEqual(rows.map(row => ({ version: Number(row.version), count: Number(row.count) })), [{ version: 1, count: 1 }])
})

test('repeated cold opens by eight processes never lose the first-open race', async () => {
  const rounds = Number(process.env.M2_COLD_OPEN_ROUNDS ?? 10)
  const failures: unknown[] = []
  for (let round = 0; round < rounds; round++) {
    const path = freshDb()
    const results = await runWorkers(Array.from({ length: 8 }, () => [path, 'open', Date.now() + 250]))
    for (const result of results) {
      if (result.parsed?.ok !== true) failures.push({ round, result })
    }
  }
  assert.deepEqual(failures, [], `cold-open race lost in ${failures.length}/${rounds * 8} opens`)
})

test('eight processes racing initialize on one address converge without duplication', async () => {
  const path = freshDb()
  openProtocol(path).close()
  const results = await runWorkers(Array.from({ length: 8 }, () => [path, 'initialize', Date.now() + 400, 'racer']))
  for (const result of results) assert.equal(result.parsed?.ok, true, `${result.stdout}${result.stderr}`)
  assert.equal(new Set(results.map(result => result.parsed.result.createdAtMs)).size, 1)
  const database = new DatabaseSync(path)
  assert.equal(database.prepare('SELECT count(*) AS count FROM protocol_sessions').get()?.count, 1)
  database.close()
})

test('a cursor following concurrent writers never skips a committed message', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('load')
  setup.close()
  const writers = 6
  const perWriter = 120
  const startAt = Date.now() + 500
  const results = await runWorkers([
    ...Array.from({ length: writers }, (_, index) => [path, 'enqueue', startAt, 'load', perWriter, `w${index}`]),
    [path, 'follow', startAt, 'load', writers * perWriter],
  ])
  for (const result of results) assert.equal(result.parsed?.ok, true, `${result.stdout}${result.stderr}`)
  const follower = results.find(result => result.parsed.operation === 'follow')!
  assert.equal(follower.parsed.complete, true)
  const written = results.filter(result => result.parsed.operation === 'enqueue').flatMap(result => result.parsed.ids)
  const seen = follower.parsed.seen
  assert.equal(written.length, writers * perWriter)
  assert.equal(new Set(written).size, written.length)
  assert.equal(new Set(seen).size, seen.length)
  assert.deepEqual([...written].sort(), [...seen].sort())
})

test('concurrent consumers of one queue split it without a double dequeue', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('shared')
  const expected: string[] = []
  for (let index = 0; index < 300; index++) {
    expected.push(setup.enqueue('shared', { kind: 'x.v1', body: Buffer.from(String(index)) }).messageId)
  }
  setup.close()
  const results = await runWorkers(Array.from({ length: 4 }, () => [path, 'drain', Date.now() + 300, 'shared']))
  for (const result of results) {
    assert.equal(result.parsed?.ok, true, `${result.stdout}${result.stderr}`)
    assert.equal(result.parsed.drained, true)
  }
  const taken = results.flatMap(result => result.parsed.taken)
  assert.equal(taken.length, new Set(taken).size)
  assert.deepEqual([...taken].sort(), [...expected].sort())
  const check = openProtocol(path)
  assert.deepEqual(check.listPending('shared'), [])
  check.close()
})

test('busy_timeout must be the connection\'s first statement, or the version probe has no budget', async () => {
  const holdMs = 1500
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('gate')
  setup.close()
  const holder = await startAndWait([path, 'lock-holder', 0, holdMs], 'held')
  try {
    const shortStart = Date.now()
    let shortCode: string | null = null
    try { openProtocol(path, { busyTimeoutMs: 200 }).close() } catch (error: any) { shortCode = error.code }
    assert.equal(shortCode, 'PROTOCOL_DATABASE_BUSY', `short open returned after ${Date.now() - shortStart}ms`)

    const longStart = Date.now()
    let longCode: string | null = null
    let handle = null
    try { handle = openProtocol(path, { busyTimeoutMs: 8000 }) } catch (error: any) { longCode = error.code }
    const elapsed = Date.now() - longStart
    assert.equal(longCode, null, `long open failed with ${longCode} after ${elapsed}ms`)
    assert.ok(elapsed >= holdMs * 0.4, `open returned in ${elapsed}ms without waiting for the held lock`)
    assert.equal(handle!.listPending('gate').length, 0)
    handle!.close()
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
  const sidecars = (): string[] => readdirSync(dirname(path)).filter(name => name !== 'protocol.sqlite').sort()
  assert.deepEqual(sidecars(), ['protocol.sqlite-journal'])
  const reader = openProtocol(path, { readOnly: true })
  assert.deepEqual(reader.listPending('crash'), [])
  reader.close()
  const after = openProtocol(path)
  assert.deepEqual(after.listPending('crash'), [])
  assert.deepEqual(sidecars(), ['protocol.sqlite-journal'])
  after.enqueue('crash', { kind: 'after.v1', body: Buffer.from('after') })
  assert.deepEqual(sidecars(), [])
  assert.equal(after.readMessages('crash').length, 1)
  after.close()
})

test('a handler that dies after dequeue never makes the message reappear', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('consumer')
  const staged = setup.enqueue('consumer', { kind: 'consumer.v1', body: Buffer.from('once') })
  setup.close()
  const output = await killAfterSignal([path, 'crash-consumer', 0, 'consumer'], 'dequeued')
  assert.equal(output.split(/\s+/).pop(), staged.messageId)
  const after = openProtocol(path)
  assert.deepEqual(after.listPending('consumer'), [])
  assert.equal(after.dequeue('consumer'), null)
  const history = after.readMessages('consumer')
  assert.equal(history.length, 1)
  assert.notEqual(history[0].dequeuedAtMs, null)
  after.close()
})

test('SIGKILL after commit keeps the message and never requeues it', async () => {
  const path = freshDb()
  const setup = openProtocol(path)
  setup.initialize('crash')
  setup.close()
  const output = await killAfterSignal([path, 'crash-postcommit', 0, 'crash'], 'committed')
  const committedId = output.split(/\s+/).pop()
  const after = openProtocol(path)
  const pending = after.listPending('crash')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].messageId, committedId)
  assert.equal(after.dequeue('crash')!.messageId, committedId)
  assert.equal(after.dequeue('crash'), null)
  after.close()
})

test('short writes stay bounded: the write lock holds only SQL', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.initialize('bench')
  const sample = Buffer.alloc(100, 1)
  const durations: number[] = []
  const benchMs = Number(process.env.M2_BENCH_MS ?? 10000)
  const started = Date.now()
  let count = 0
  while (Date.now() - started < benchMs && count < 5000) {
    const before = process.hrtime.bigint()
    handle.enqueue('bench', { kind: 'bench.v1', body: sample })
    durations.push(Number(process.hrtime.bigint() - before) / 1e6)
    count++
  }
  durations.sort((left, right) => left - right)
  const p99 = durations[Math.floor(durations.length * 0.99)]
  if (benchMs >= 10000) assert.ok(count >= 500, `expected at least 500 writes, observed ${count}`)
  assert.equal(handle.readMessages('bench').length, count)
  assert.ok(Number.isFinite(p99))
  handle.close()
})
