import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { inspectProtocol, isSupportedSqliteVersion } from './engine.js'
import {
  MIN_SQLITE_VERSION,
  ProtocolError,
  canonicalPreimage,
  openProtocol,
} from './index.js'
import { PROTOCOL_MIGRATIONS } from './schema.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new(path: string) => {
    exec(sql: string): void
    prepare(sql: string): {
      get(...params: unknown[]): Record<string, unknown> | undefined
      all(...params: unknown[]): Record<string, unknown>[]
      run(...params: unknown[]): { changes: number | bigint }
    }
    close(): void
  }
}

const roots: string[] = []
const freshRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'session-protocol-'))
  roots.push(root)
  return root
}
const freshDb = (): string => join(freshRoot(), 'protocol.sqlite')
process.on('exit', () => {
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true }) } catch {}
  }
})

const codeOf = (body: () => unknown): string | null => {
  try {
    body()
    return null
  } catch (error) {
    assert.ok(error instanceof ProtocolError, `expected ProtocolError, got ${String(error)}`)
    return error.code
  }
}
const bytes = (value: string): Buffer => Buffer.from(value, 'utf8')
const message = (overrides: Record<string, unknown> = {}): any => ({
  kind: 'test.v1',
  body: bytes('hello'),
  ...overrides,
})

test('open path: relative paths are rejected without consulting cwd', () => {
  const root = freshRoot()
  const previous = process.cwd()
  process.chdir(root)
  try {
    for (const path of ['protocol.sqlite', './protocol.sqlite', '../protocol.sqlite']) {
      assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_PATH_NOT_ABSOLUTE')
    }
    assert.throws(() => readFileSync(join(root, 'protocol.sqlite')))
  } finally {
    process.chdir(previous)
  }
})

test('open path: malformed absolute paths are rejected', () => {
  const root = freshRoot()
  assert.equal(codeOf(() => openProtocol('')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
  assert.equal(codeOf(() => openProtocol(`${root}/`)), 'PROTOCOL_PATH_INVALID')
  assert.equal(codeOf(() => openProtocol(`/tmp/has${String.fromCharCode(0)}nul.sqlite`)), 'PROTOCOL_PATH_INVALID')
  assert.equal(codeOf(() => openProtocol('file:/tmp/x.sqlite')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
  assert.equal(codeOf(() => openProtocol(Buffer.from('/tmp/x') as any)), 'PROTOCOL_PATH_NOT_ABSOLUTE')
  openProtocol(join(root, 'a b.sqlite')).close()
})

test('open path: a missing parent directory fails loudly and creates nothing', () => {
  const root = freshRoot()
  const path = join(root, 'not', 'there', 'protocol.sqlite')
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_PATH_PARENT_MISSING')
  assert.throws(() => readFileSync(join(root, 'not')))
})

test('open path: the database file itself is created when the parent exists', () => {
  const path = freshDb()
  openProtocol(path).close()
  assert.ok(readFileSync(path).length > 0)
})

test('open path: two symlinked paths to one database observe one committed state', () => {
  const root = freshRoot()
  const real = join(root, 'real.sqlite')
  const link = join(root, 'link.sqlite')
  const first = openProtocol(real)
  first.initialize('s1')
  symlinkSync(real, link)
  const second = openProtocol(link)
  second.enqueue('s1', message())
  assert.equal(first.listPending('s1').length, 1)
  first.close()
  second.close()
})

test('sqlite version gate is derived from the features used, and compares numerically', () => {
  assert.equal(MIN_SQLITE_VERSION, '3.38.0')
  for (const version of ['3.38.0', '3.50.4', '3.51.3', '4.0.0']) {
    assert.equal(isSupportedSqliteVersion(version), true, version)
  }
  for (const version of ['3.37.0', '3.36.0', '3.9.0', '3.7.0']) {
    assert.equal(isSupportedSqliteVersion(version), false, version)
  }
})

test('every SQL feature the floor is derived from actually works at the floor', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.enqueue('s1', message({ headers: { a: 'b' }, idempotencyKey: 'k' }))
  assert.match(inspectProtocol(handle).queryPlans().dequeueHead, /protocol_messages_pending_fifo/)
  assert.ok(handle.enqueue('s1', message({ body: bytes('second') })).enqueueSeq > 0)
  assert.equal(codeOf(() => handle.initialize('bad/id')), 'PROTOCOL_SESSION_ID_INVALID')
  handle.close()
})

test('the live driver satisfies the gate the engine enforces', () => {
  const database = new DatabaseSync(':memory:')
  const version = database.prepare('SELECT sqlite_version() AS version').get()?.version
  database.close()
  assert.equal(isSupportedSqliteVersion(version), true, `driver SQLite ${String(version)} is unsupported`)
})

test('every connection asserts its mandatory pragmas by reading them back', () => {
  const handle = openProtocol(freshDb(), { busyTimeoutMs: 7000 })
  assert.deepEqual(inspectProtocol(handle).pragmas(), {
    journal_mode: 'delete', foreign_keys: 1, synchronous: 2, busy_timeout: 7000,
  })
  handle.close()
})

test('a database left in WAL is refused, not converted', () => {
  const path = freshDb()
  const database = new DatabaseSync(path)
  database.prepare('PRAGMA journal_mode=WAL').get()
  database.exec('CREATE TABLE placeholder(a INTEGER PRIMARY KEY) STRICT')
  database.close()
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_JOURNAL_MODE_UNSUPPORTED')
  const check = new DatabaseSync(path)
  assert.equal(check.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal')
  check.close()
})

test('the protocol depends on no -wal or -shm sidecar, at rest or mid-transaction', () => {
  const path = freshDb()
  const sidecars = (): string[] => readdirSync(dirname(path)).filter(name => name !== 'protocol.sqlite').sort()
  const handle = openProtocol(path)
  handle.initialize('s1')
  handle.enqueue('s1', message())
  assert.deepEqual(sidecars(), [])
  handle.withTransaction(tx => {
    tx.enqueue('s1', message({ body: bytes('mid') }))
    assert.deepEqual(sidecars(), ['protocol.sqlite-journal'])
  })
  assert.deepEqual(sidecars(), [])
  handle.close()
})

test('session ids: accepted and rejected character sets', () => {
  const handle = openProtocol(freshDb())
  for (const id of ['a', 'de57398c-0150-454e-805f-27f02f8e477f', 'ok-id_9', 'A'.repeat(256)]) {
    assert.equal(handle.initialize(id).sessionId, id)
  }
  for (const id of ['../etc/passwd', 'a/b', 'a.b', '.', '..', 'has space', '-leading', 'A'.repeat(257), '']) {
    assert.equal(codeOf(() => handle.initialize(id)), 'PROTOCOL_SESSION_ID_INVALID', JSON.stringify(id))
  }
  handle.close()
})

test('the address space is flat and global within one database path', () => {
  const handle = openProtocol(freshDb())
  const shared = 'de57398c-0150-454e-805f-27f02f8e477f'
  handle.initialize(shared)
  handle.enqueue(shared, message({ body: bytes('first') }))
  handle.initialize(shared)
  assert.equal(handle.listPending(shared).length, 1)
  assert.equal(inspectProtocol(handle).counts().sessions, 1)
  const namespace = 'p-home-jeffry-spexcode--sessions__' + shared
  assert.equal(handle.initialize(namespace).sessionId, namespace)
  assert.equal(inspectProtocol(handle).counts().sessions, 2)
  handle.close()
})

test('session ids: a non-string id is rejected in memory, never coerced by SQLite affinity', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  assert.equal(codeOf(() => handle.initialize(7 as any)), 'PROTOCOL_SESSION_ID_INVALID')
  assert.equal(codeOf(() => handle.initialize(null as any)), 'PROTOCOL_SESSION_ID_INVALID')
  handle.close()
  const database = new DatabaseSync(path)
  assert.equal(database.prepare('SELECT count(*) AS count FROM protocol_sessions').get()?.count, 0)
  database.close()
})

test('initialize is idempotent and retirement is terminal', () => {
  const handle = openProtocol(freshDb())
  const first = handle.initialize('s1')
  assert.equal(handle.initialize('s1').createdAtMs, first.createdAtMs)
  handle.retire('s1')
  assert.equal(codeOf(() => handle.initialize('s1')), 'PROTOCOL_SESSION_RETIRED')
  assert.equal(codeOf(() => handle.enqueue('s1', message())), 'PROTOCOL_SESSION_RETIRED')
  handle.close()
})

test('enqueue to an unknown address fails and creates neither address nor message', () => {
  const handle = openProtocol(freshDb())
  assert.equal(codeOf(() => handle.enqueue('ghost', message())), 'PROTOCOL_SESSION_UNKNOWN')
  assert.equal(codeOf(() => handle.dequeue('ghost')), 'PROTOCOL_SESSION_UNKNOWN')
  assert.equal(codeOf(() => handle.listPending('ghost')), 'PROTOCOL_SESSION_UNKNOWN')
  assert.deepEqual(inspectProtocol(handle).counts(), { sessions: 0, messages: 0 })
  handle.close()
})

test('retirement keeps the tombstone and the whole history readable', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.enqueue('s1', message())
  assert.equal(codeOf(() => handle.retire('s1')), 'PROTOCOL_RETIRE_NON_EMPTY')
  assert.equal(handle.listPending('s1').length, 1)
  handle.dequeue('s1')
  assert.ok(handle.retire('s1').retiredAtMs! >= 0)
  assert.equal(handle.readMessages('s1').length, 1)
  assert.deepEqual(handle.listPending('s1'), [])
  handle.close()
})

test('message_id is protocol-generated; a producer-supplied one is refused', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ messageId: 'mine' }))), 'PROTOCOL_MESSAGE_INVALID')
  const ids = new Set<string>()
  for (let index = 0; index < 500; index++) {
    const id = handle.enqueue('s1', message({ body: bytes(String(index)) })).messageId
    assert.match(id, /^[0-9a-f]{32}$/)
    ids.add(id)
  }
  assert.equal(ids.size, 500)
  handle.close()
})

test('payload_hash preimage is reproducible from the written specification alone', () => {
  const u32 = (value: number): Buffer => { const out = Buffer.alloc(4); out.writeUInt32BE(value); return out }
  const u64 = (value: number): Buffer => { const out = Buffer.alloc(8); out.writeBigUInt64BE(BigInt(value)); return out }
  const field = (value: string): Buffer => { const out = bytes(value); return Buffer.concat([u32(out.length), out]) }
  const optional = (value: string): Buffer => Buffer.concat([Buffer.from([1]), field(value)])
  const body = bytes('hello')
  const expected = Buffer.concat([
    u32(1), field('s1'), optional('sender'), field('test.v1'), u32(2),
    field('alpha'), field('1'), field('beta'), field('2'), u64(body.length), body,
  ])
  const envelope = {
    protocolVersion: 1, targetSessionId: 's1', senderSessionId: 'sender', kind: 'test.v1',
    headers: { beta: '2', alpha: '1' }, body,
  }
  assert.deepEqual(canonicalPreimage(envelope), expected)
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.initialize('sender')
  const stored = handle.enqueue('s1', {
    kind: 'test.v1', body, senderSessionId: 'sender', headers: { beta: '2', alpha: '1' },
  })
  assert.equal(stored.payloadHash, createHash('sha256').update(expected).digest('hex'))
  handle.close()
})

test('header order on input never changes the hash; header keys are ASCII-only', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const first = handle.enqueue('s1', message({ headers: { z: '1', a: '2', m: '3' } }))
  const second = handle.enqueue('s1', message({ headers: { m: '3', z: '1', a: '2' } }))
  assert.equal(first.payloadHash, second.payloadHash)
  assert.equal(codeOf(() => handle.enqueue('s1', message({ headers: { ['n' + String.fromCharCode(0xe4)]: 'x' } }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ headers: { k: 5 } }))), 'PROTOCOL_MESSAGE_INVALID')
  handle.close()
})

test('body must be explicit bytes; a string is not an encoding the protocol guesses', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.enqueue('s1', { kind: 'k.v1', body: 'hello' as any })), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', { kind: 'k.v1' } as any)), 'PROTOCOL_MESSAGE_INVALID')
  handle.close()
})

test('body and headers round-trip byte-exactly, including embedded NULs', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const body = Buffer.from([0, 1, 2, 255, 0, 128, 10])
  handle.enqueue('s1', { kind: 'opaque.v9', body, headers: { 'x-a_b.c': 'v' } })
  const received = handle.dequeue('s1')!
  assert.equal(Buffer.compare(Buffer.from(received.body), body), 0)
  assert.deepEqual(received.headers, { 'x-a_b.c': 'v' })
  handle.close()
})

test('exact idempotent replay returns the first row; changed bytes conflict', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const first = handle.enqueue('s1', message({ idempotencyKey: 'k1' }))
  const replay = handle.enqueue('s1', message({ idempotencyKey: 'k1' }))
  assert.equal(replay.messageId, first.messageId)
  assert.equal(replay.enqueueSeq, first.enqueueSeq)
  assert.equal(inspectProtocol(handle).counts().messages, 1)
  assert.equal(codeOf(() => handle.enqueue('s1', message({ idempotencyKey: 'k1', body: bytes('changed') }))), 'PROTOCOL_IDEMPOTENCY_CONFLICT')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ idempotencyKey: 'k1', headers: { a: 'b' } }))), 'PROTOCOL_IDEMPOTENCY_CONFLICT')
  assert.equal(inspectProtocol(handle).counts().messages, 1)
  handle.close()
})

test('an honest retry must not be punished for minting a fresh message id', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const first = handle.enqueue('s1', message({ idempotencyKey: 'retry' }))
  const replay = handle.enqueue('s1', message({ idempotencyKey: 'retry' }))
  assert.equal(replay.messageId, first.messageId)
  handle.close()
})

test('unkeyed messages coexist without limit', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  for (let index = 0; index < 5; index++) handle.enqueue('s1', message())
  assert.equal(inspectProtocol(handle).counts().messages, 5)
  handle.close()
})

test('FIFO order, and null means exactly one thing', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.enqueue('s1', message({ body: bytes('A') }))
  handle.enqueue('s1', message({ body: bytes('B') }))
  assert.equal(Buffer.from(handle.dequeue('s1')!.body).toString(), 'A')
  assert.equal(Buffer.from(handle.dequeue('s1')!.body).toString(), 'B')
  assert.equal(handle.dequeue('s1'), null)
  assert.deepEqual(handle.readMessages('s1').map(item => item.dequeuedAtMs !== null), [true, true])
  handle.close()
})

test('readMessages cursor is stable and validated', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.initialize('s2')
  const first = handle.enqueue('s1', message({ body: bytes('a') }))
  handle.enqueue('s2', message())
  const second = handle.enqueue('s1', message({ body: bytes('b') }))
  assert.deepEqual(handle.readMessages('s1', first.enqueueSeq).map(item => Buffer.from(item.body).toString()), ['b'])
  assert.equal(handle.readMessages('s1', second.enqueueSeq).length, 0)
  assert.equal(codeOf(() => handle.readMessages('s1', -1)), 'PROTOCOL_CURSOR_INVALID')
  assert.equal(codeOf(() => handle.readMessages('s1', 1.5)), 'PROTOCOL_CURSOR_INVALID')
  handle.close()
})

test('size ceilings are enforced before any write', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ body: Buffer.alloc(1048577) }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.ok(handle.enqueue('s1', message({ body: Buffer.alloc(1048576) })).enqueueSeq > 0)
  assert.equal(codeOf(() => handle.enqueue('s1', message({ kind: '' }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ kind: 'k'.repeat(65) }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ headers: { k: 'v'.repeat(4097) } }))), 'PROTOCOL_MESSAGE_INVALID')
  const many: Record<string, string> = {}
  for (let index = 0; index < 65; index++) many[`h${index}`] = 'v'
  assert.equal(codeOf(() => handle.enqueue('s1', message({ headers: many }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', message({ idempotencyKey: 'k'.repeat(257) }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(inspectProtocol(handle).counts().messages, 1)
  handle.close()
})

test('each migration checksums only its own bytes', () => {
  assert.ok(PROTOCOL_MIGRATIONS.length >= 1)
  for (const migration of PROTOCOL_MIGRATIONS) {
    assert.equal(migration.checksum, createHash('sha256').update(Buffer.from(migration.sql, 'utf8')).digest('hex'))
  }
})

test('migration replay against an already-migrated database is a no-op', () => {
  const path = freshDb()
  const first = openProtocol(path)
  first.initialize('s1')
  first.close()
  const second = openProtocol(path)
  assert.equal(second.initialize('s1').sessionId, 's1')
  second.close()
  const database = new DatabaseSync(path)
  assert.equal(database.prepare("SELECT count(*) AS count FROM schema_migrations WHERE component='session-protocol'").get()?.count, 1)
  database.close()
})

test('a rewritten migration checksum fails before any protocol read or write', () => {
  const path = freshDb()
  openProtocol(path).close()
  const database = new DatabaseSync(path)
  database.prepare("UPDATE schema_migrations SET checksum='deadbeef' WHERE component='session-protocol' AND version=1").run()
  database.close()
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH')
})

test('a future schema generation is refused rather than half-understood', () => {
  const path = freshDb()
  openProtocol(path).close()
  const database = new DatabaseSync(path)
  database.prepare("INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES('session-protocol',9999,'x',1)").run()
  database.close()
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED')
})

test('protocol tables the registry does not account for are a loud inconsistency', () => {
  const path = freshDb()
  openProtocol(path).close()
  const database = new DatabaseSync(path)
  database.prepare("DELETE FROM schema_migrations WHERE component='session-protocol' AND version=1").run()
  database.close()
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT')
})

test('an adopter component may share schema_migrations without colliding', () => {
  const path = freshDb()
  openProtocol(path).close()
  const database = new DatabaseSync(path)
  database.prepare("INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES('adopter-state',1,'abc',1)").run()
  database.close()
  const handle = openProtocol(path)
  assert.equal(handle.initialize('s1').sessionId, 's1')
  handle.close()
})

test('a read-only handle reads and refuses every write', () => {
  const path = freshDb()
  const writer = openProtocol(path)
  writer.initialize('s1')
  writer.enqueue('s1', message())
  writer.close()
  const reader = openProtocol(path, { readOnly: true })
  assert.equal(reader.listPending('s1').length, 1)
  assert.equal(reader.readMessages('s1').length, 1)
  assert.equal(codeOf(() => reader.enqueue('s1', message())), 'PROTOCOL_DATABASE_READONLY')
  assert.equal(codeOf(() => reader.dequeue('s1')), 'PROTOCOL_DATABASE_READONLY')
  assert.equal(codeOf(() => reader.initialize('s2')), 'PROTOCOL_DATABASE_READONLY')
  assert.equal(codeOf(() => reader.retire('s1')), 'PROTOCOL_DATABASE_READONLY')
  reader.close()
})

test('a read-only handle refuses an unmigrated database instead of guessing', () => {
  const path = freshDb()
  writeFileSync(path, '')
  assert.equal(codeOf(() => openProtocol(path, { readOnly: true })), 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED')
})

test('a corrupt database fails loudly and is never reported as an empty queue', () => {
  const path = freshDb()
  const writer = openProtocol(path)
  writer.initialize('s1')
  for (let index = 0; index < 200; index++) writer.enqueue('s1', message({ body: Buffer.alloc(400, index % 251) }))
  writer.close()
  const data = readFileSync(path)
  data.fill(0x5a, 4096)
  writeFileSync(path, data)
  const code = codeOf(() => {
    const handle = openProtocol(path)
    const pending = handle.listPending('s1')
    handle.close()
    assert.fail(`corrupt database answered with ${pending.length} rows`)
  })
  assert.ok(['PROTOCOL_DATABASE_CORRUPT', 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED'].includes(code!))
})

test('the transaction body is synchronous only: a promise-returning callback is refused', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.withTransaction(async () => {})), 'PROTOCOL_TRANSACTION_INVALID')
  assert.equal(codeOf(() => handle.withTransaction(() => Promise.resolve(1))), 'PROTOCOL_TRANSACTION_INVALID')
  assert.equal(inspectProtocol(handle).counts().messages, 0)
  handle.close()
})

test('an adopter table mutation and enqueue commit or roll back together', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.initialize('s1')
  const database = new DatabaseSync(path)
  database.exec('CREATE TABLE component_edges (id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT')
  database.close()
  handle.withTransaction(tx => {
    tx.exec("INSERT INTO component_edges(note) VALUES('kept')")
    tx.enqueue('s1', message())
  })
  assert.throws(() => handle.withTransaction(tx => {
    tx.exec("INSERT INTO component_edges(note) VALUES('rolled-back')")
    tx.enqueue('s1', message({ body: bytes('rolled-back') }))
    throw new Error('abort')
  }))
  assert.equal(inspectProtocol(handle).counts().messages, 1)
  const check = new DatabaseSync(path)
  assert.deepEqual(check.prepare('SELECT note FROM component_edges').all().map(row => row.note), ['kept'])
  check.close()
  handle.close()
})

test('every declared index is the one the planner actually uses', () => {
  const handle = openProtocol(freshDb())
  const plans = inspectProtocol(handle).queryPlans()
  assert.match(plans.dequeueHead, /USING INDEX protocol_messages_pending_fifo/)
  assert.doesNotMatch(plans.dequeueHead, /TEMP B-TREE/)
  assert.match(plans.listPending, /USING INDEX protocol_messages_pending_fifo/)
  assert.match(plans.readMessages, /USING INDEX protocol_messages_history/)
  assert.match(plans.idempotencyLookup, /USING INDEX protocol_messages_idempotency/)
  handle.close()
})

test('protocol core neither performs nor claims a storage-locality determination', async () => {
  const entry = await import('./index.js') as Record<string, unknown>
  assert.equal(entry.isRejectedFilesystemType, undefined)
  assert.equal(entry.NETWORK_FILESYSTEM_TYPES, undefined)
  for (const file of ['engine.ts', 'schema.ts', 'canonical.ts', 'errors.ts', 'index.ts']) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), 'utf8'), /statfs|0x6969|0xff534d42/i)
  }
})

test('a reader is not blocked by an open write, and sees only committed state', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.initialize('s1')
  handle.enqueue('s1', message())
  const reader = openProtocol(path, { readOnly: true, busyTimeoutMs: 100 })
  const holder = new DatabaseSync(path)
  holder.exec('PRAGMA busy_timeout=100')
  holder.exec('BEGIN IMMEDIATE')
  holder.prepare("INSERT INTO protocol_sessions(session_id,created_at_ms) VALUES('mid',1)").run()
  try {
    assert.equal(reader.listPending('s1').length, 1)
    assert.equal(codeOf(() => reader.initialize('mid')), 'PROTOCOL_DATABASE_READONLY')
  } finally {
    holder.exec('ROLLBACK')
    holder.close()
    reader.close()
    handle.close()
  }
})

test('write contention surfaces as a loud busy error, never as an empty result', () => {
  const path = freshDb()
  const setup = openProtocol(path, { busyTimeoutMs: 50 })
  setup.initialize('s1')
  setup.enqueue('s1', message())
  setup.close()
  const handle = openProtocol(path, { busyTimeoutMs: 50 })
  const holder = new DatabaseSync(path)
  holder.exec('PRAGMA busy_timeout=50')
  holder.exec('BEGIN IMMEDIATE')
  holder.prepare("INSERT INTO protocol_sessions(session_id,created_at_ms) VALUES('holder',1)").run()
  try {
    assert.equal(codeOf(() => handle.enqueue('s1', message())), 'PROTOCOL_DATABASE_BUSY')
    assert.equal(codeOf(() => handle.dequeue('s1')), 'PROTOCOL_DATABASE_BUSY')
    assert.equal(handle.listPending('s1').length, 1)
  } finally {
    holder.exec('ROLLBACK')
    holder.close()
    handle.close()
  }
})

test('an unwritable database directory fails loudly at open', () => {
  const root = freshRoot()
  const directory = join(root, 'locked')
  mkdirSync(directory)
  chmodSync(directory, 0o500)
  try {
    assert.equal(codeOf(() => openProtocol(join(directory, 'protocol.sqlite'))), 'PROTOCOL_DATABASE_UNAVAILABLE')
  } finally {
    chmodSync(directory, 0o700)
  }
})
