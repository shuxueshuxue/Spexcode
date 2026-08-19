// M2 SQLite engine conformance vectors. These encode the frozen engine details; the engine is
// written to satisfy them, never the other way round.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// M2_ENGINE lets the identical vectors be driven against the deliberately-naive stub in stubs/,
// so a failure is an assertion of ours firing rather than a missing file.
const {
  openProtocol,
  ProtocolError,
  MIGRATIONS,
  MIN_SQLITE_VERSION,
  canonicalPreimage,
  isSupportedSqliteVersion,
  isRejectedFilesystemType,
  NETWORK_FILESYSTEM_TYPES,
} = await import(process.env.M2_ENGINE || '../engine.mjs')

// M2_DRIVER drives the identical vectors through the second candidate binding. The contract is the
// schema and the codes, not the binding, so both must pass unchanged.
let activeDriver = (await import(process.env.M2_ENGINE || '../engine.mjs')).nodeSqliteDriver
if (process.env.M2_DRIVER === 'better-sqlite3') {
  const engine = await import(process.env.M2_ENGINE || '../engine.mjs')
  activeDriver = (await import('../drivers/better-sqlite3.mjs')).betterSqlite3Driver
  engine.setDefaultDriver(activeDriver)
}
// Raw connections in these vectors must use the SAME build as the engine under test. Two different
// SQLite builds in one process do not see each other's locks (POSIX advisory locks are per-process),
// so mixing them here would test the harness rather than the engine.
const rawOpen = path => activeDriver.open(path, { readOnly: false })

const roots = []
const freshRoot = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sqlite-m2-'))
  roots.push(dir)
  return dir
}
const freshDb = () => join(freshRoot(), 'protocol.sqlite')
process.on('exit', () => { for (const r of roots) { try { rmSync(r, { recursive: true, force: true }) } catch {} } })

const codeOf = fn => {
  try { fn(); return null } catch (error) {
    assert.ok(error instanceof ProtocolError, `expected ProtocolError, got ${error?.stack || error}`)
    return error.code
  }
}
const body = s => Buffer.from(s, 'utf8')
const msg = (over = {}) => ({ kind: 'test.v1', body: body('hello'), ...over })

// ---------------------------------------------------------------- open path

test('open path: relative paths are rejected without consulting cwd', () => {
  const root = freshRoot()
  const previous = process.cwd()
  process.chdir(root)
  try {
    assert.equal(codeOf(() => openProtocol('protocol.sqlite')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
    assert.equal(codeOf(() => openProtocol('./protocol.sqlite')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
    assert.equal(codeOf(() => openProtocol('../protocol.sqlite')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
    // Rejection must not have created anything at the cwd-relative location.
    assert.throws(() => readFileSync(join(root, 'protocol.sqlite')))
  } finally { process.chdir(previous) }
})

test('open path: malformed absolute paths are rejected', () => {
  const root = freshRoot()
  assert.equal(codeOf(() => openProtocol('')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
  assert.equal(codeOf(() => openProtocol(root + '/')), 'PROTOCOL_PATH_INVALID')
  assert.equal(codeOf(() => openProtocol('/tmp/has' + String.fromCharCode(0) + 'nul.sqlite')), 'PROTOCOL_PATH_INVALID')
  assert.equal(codeOf(() => openProtocol('file:/tmp/x.sqlite')), 'PROTOCOL_PATH_NOT_ABSOLUTE')
  assert.equal(codeOf(() => openProtocol(Buffer.from('/tmp/x'))), 'PROTOCOL_PATH_NOT_ABSOLUTE')
  // A space is an ordinary path character; macOS state roots contain them.
  openProtocol(join(root, 'a b.sqlite')).close()
})

test('open path: a missing parent directory fails loudly and creates nothing', () => {
  const root = freshRoot()
  const nested = join(root, 'not', 'there', 'protocol.sqlite')
  assert.equal(codeOf(() => openProtocol(nested)), 'PROTOCOL_PATH_PARENT_MISSING')
  assert.throws(() => readFileSync(join(root, 'not')))
})

test('open path: the database file itself is created when the parent exists', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.close()
  assert.ok(readFileSync(path).length > 0)
})

test('open path: two symlinked paths to one database observe one committed state', () => {
  const root = freshRoot()
  const real = join(root, 'real.sqlite')
  const link = join(root, 'link.sqlite')
  const a = openProtocol(real)
  a.initialize('s1')
  symlinkSync(real, link)
  const b = openProtocol(link)
  b.enqueue('s1', msg())
  assert.equal(a.listPending('s1').length, 1)
  a.close(); b.close()
})

// ---------------------------------------------------------------- version gate

test('sqlite version gate compares numerically, not lexicographically', () => {
  assert.equal(MIN_SQLITE_VERSION, '3.51.3')
  assert.equal(isSupportedSqliteVersion('3.51.3'), true)
  assert.equal(isSupportedSqliteVersion('3.51.4'), true)
  assert.equal(isSupportedSqliteVersion('3.53.4'), true)
  assert.equal(isSupportedSqliteVersion('4.0.0'), true)
  assert.equal(isSupportedSqliteVersion('3.51.2'), false)
  assert.equal(isSupportedSqliteVersion('3.50.4'), false)
  // The lexicographic trap: "3.9.0" > "3.51.3" as strings but is far older.
  assert.equal(isSupportedSqliteVersion('3.9.0'), false)
  assert.equal(isSupportedSqliteVersion('3.7.0'), false)
})

test('the live driver satisfies the gate the engine enforces', () => {
  const db = new DatabaseSync(':memory:')
  const live = db.prepare('SELECT sqlite_version() AS v').get().v
  db.close()
  assert.equal(isSupportedSqliteVersion(live), true, `driver SQLite ${live} is below ${MIN_SQLITE_VERSION}`)
})

// ---------------------------------------------------------------- pragmas

test('every connection asserts its mandatory pragmas by reading them back', () => {
  const handle = openProtocol(freshDb(), { busyTimeoutMs: 7000 })
  assert.deepEqual(handle.pragmas(), {
    journal_mode: 'wal',
    foreign_keys: 1,
    synchronous: 2,
    busy_timeout: 7000,
  })
  handle.close()
})

// ---------------------------------------------------------------- session ids

test('session ids: accepted and rejected character sets', () => {
  const handle = openProtocol(freshDb())
  for (const id of ['a', 'de57398c-0150-454e-805f-27f02f8e477f', 'ok-id_9', 'A'.repeat(256)]) {
    assert.equal(handle.initialize(id).sessionId, id)
  }
  for (const id of ['../etc/passwd', 'a/b', 'a.b', '.', '..', 'has space', '-leading', 'A'.repeat(257), '']) {
    assert.equal(codeOf(() => handle.initialize(id)), 'PROTOCOL_SESSION_ID_INVALID', `id ${JSON.stringify(id)}`)
  }
  handle.close()
})

test('the address space is flat and global within one database path', () => {
  // A protocol address is one opaque id per databasePath. Multi-project adopters namespace the id
  // themselves; the protocol has no project dimension, so two projects reusing one id collide.
  const handle = openProtocol(freshDb())
  const shared = 'de57398c-0150-454e-805f-27f02f8e477f'
  handle.initialize(shared)
  handle.enqueue(shared, msg({ body: body('project-a') }))
  handle.initialize(shared)   // "project B" initialising the same id gets project A's inbox
  assert.equal(handle.listPending(shared).length, 1)
  assert.equal(handle.counts().sessions, 1)

  // The namespacing an adopter must do instead, at real fleet lengths.
  const encoded = '/home/jeffry/spexcode/.worktrees/session-protocol-de57'.replace(/[/.]/g, '-')
  assert.ok(encoded.startsWith('-'), 'encodeProject() output starts with a dash')
  assert.equal(codeOf(() => handle.initialize(encoded + '__' + shared)), 'PROTOCOL_SESSION_ID_INVALID')
  const namespaced = 'p' + encoded + '__' + shared
  assert.equal(namespaced.length, 93)
  assert.equal(handle.initialize(namespaced).sessionId, namespaced)
  assert.equal(handle.counts().sessions, 2)
  handle.close()
})

test('session ids: a non-string id is rejected in memory, never coerced by SQLite affinity', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  assert.equal(codeOf(() => handle.initialize(7)), 'PROTOCOL_SESSION_ID_INVALID')
  assert.equal(codeOf(() => handle.initialize(null)), 'PROTOCOL_SESSION_ID_INVALID')
  handle.close()
  // STRICT alone does not protect: it would have stored the number 7 as the text "7.0".
  const raw = rawOpen(path)
  assert.equal(raw.prepare('SELECT count(*) AS c FROM protocol_sessions').get().c, 0)
  raw.close()
})

// ---------------------------------------------------------------- addresses

test('initialize is idempotent and retirement is terminal', () => {
  const handle = openProtocol(freshDb())
  const first = handle.initialize('s1')
  const again = handle.initialize('s1')
  assert.equal(again.createdAtMs, first.createdAtMs)
  handle.retire('s1')
  assert.equal(codeOf(() => handle.initialize('s1')), 'PROTOCOL_SESSION_RETIRED')
  assert.equal(codeOf(() => handle.enqueue('s1', msg())), 'PROTOCOL_SESSION_RETIRED')
  handle.close()
})

test('enqueue to an unknown address fails and creates neither address nor message', () => {
  const handle = openProtocol(freshDb())
  assert.equal(codeOf(() => handle.enqueue('ghost', msg())), 'PROTOCOL_SESSION_UNKNOWN')
  assert.equal(codeOf(() => handle.dequeue('ghost')), 'PROTOCOL_SESSION_UNKNOWN')
  assert.equal(codeOf(() => handle.listPending('ghost')), 'PROTOCOL_SESSION_UNKNOWN')
  assert.deepEqual(handle.counts(), { sessions: 0, messages: 0 })
  handle.close()
})

test('retirement keeps the tombstone and the whole history readable', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.enqueue('s1', msg({ body: body('one') }))
  assert.equal(codeOf(() => handle.retire('s1')), 'PROTOCOL_RETIRE_NON_EMPTY')
  assert.equal(handle.listPending('s1').length, 1, 'a refused retire changes nothing')
  handle.dequeue('s1')
  const retired = handle.retire('s1')
  assert.ok(retired.retiredAtMs > 0)
  assert.equal(handle.readMessages('s1').length, 1, 'history survives retirement')
  assert.deepEqual(handle.listPending('s1'), [], 'retire required an empty queue, so this is measured, not shortcut')
  handle.close()
})

// ---------------------------------------------------------------- message identity

test('message_id is protocol-generated; a producer-supplied one is refused', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ messageId: 'mine' }))), 'PROTOCOL_MESSAGE_INVALID')
  const seen = new Set()
  for (let i = 0; i < 500; i++) {
    const id = handle.enqueue('s1', msg({ body: body(String(i)) })).messageId
    assert.match(id, /^[0-9a-f]{32}$/)
    seen.add(id)
  }
  assert.equal(seen.size, 500)
  handle.close()
})

// ---------------------------------------------------------------- canonical bytes

test('payload_hash preimage is reproducible from the written specification alone', () => {
  // Built here by hand from the frozen wire rules, independently of engine.mjs.
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
  const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b }
  const field = s => { const u = Buffer.from(s, 'utf8'); return Buffer.concat([u32(u.length), u]) }
  const opt = s => (s === null || s === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), field(s)]))
  const payload = body('hello')
  const expected = Buffer.concat([
    u32(1),                       // protocolVersion
    field('s1'),                  // targetSessionId
    opt('sender'),                // senderSessionId
    field('test.v1'),             // kind
    u32(2),                       // header count
    field('alpha'), field('1'),   // headers, ascending by UTF-8 key bytes
    field('beta'), field('2'),
    u64(payload.length), payload, // body
  ])

  const input = {
    protocolVersion: 1,
    targetSessionId: 's1',
    senderSessionId: 'sender',
    kind: 'test.v1',
    headers: { beta: '2', alpha: '1' },   // deliberately out of order on input
    body: payload,
  }
  assert.deepEqual(canonicalPreimage(input), expected)

  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.initialize('sender')
  const stored = handle.enqueue('s1', {
    kind: 'test.v1', body: payload, senderSessionId: 'sender', headers: { beta: '2', alpha: '1' },
  })
  assert.equal(stored.payloadHash, createHash('sha256').update(expected).digest('hex'))
  handle.close()
})

test('header order on input never changes the hash; header keys are ASCII-only', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const a = handle.enqueue('s1', msg({ headers: { z: '1', a: '2', m: '3' } }))
  const b = handle.enqueue('s1', msg({ headers: { m: '3', z: '1', a: '2' } }))
  assert.equal(a.payloadHash, b.payloadHash)
  // Non-ASCII keys are refused, so UTF-8 vs UTF-16 ordering can never split two implementations.
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ headers: { ['n' + String.fromCharCode(0xe4)]: 'x' } }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ headers: { k: 5 } }))), 'PROTOCOL_MESSAGE_INVALID')
  handle.close()
})

test('body must be explicit bytes; a string is not an encoding the protocol guesses', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.enqueue('s1', { kind: 'k.v1', body: 'hello' })), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', { kind: 'k.v1' })), 'PROTOCOL_MESSAGE_INVALID')
  handle.close()
})

test('body and headers round-trip byte-exactly, including embedded NULs', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const raw = Buffer.from([0, 1, 2, 255, 0, 128, 10])
  handle.enqueue('s1', { kind: 'opaque.v9', body: raw, headers: { 'x-a_b.c': 'v' } })
  const got = handle.dequeue('s1')
  assert.equal(Buffer.compare(Buffer.from(got.body), raw), 0)
  assert.deepEqual(got.headers, { 'x-a_b.c': 'v' })
  handle.close()
})

// ---------------------------------------------------------------- idempotency

test('exact idempotent replay returns the first row; changed bytes conflict', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const first = handle.enqueue('s1', msg({ idempotencyKey: 'k1' }))
  const replay = handle.enqueue('s1', msg({ idempotencyKey: 'k1' }))
  assert.equal(replay.messageId, first.messageId)
  assert.equal(replay.enqueueSeq, first.enqueueSeq)
  assert.equal(handle.counts().messages, 1)
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ idempotencyKey: 'k1', body: body('changed') }))), 'PROTOCOL_IDEMPOTENCY_CONFLICT')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ idempotencyKey: 'k1', headers: { a: 'b' } }))), 'PROTOCOL_IDEMPOTENCY_CONFLICT')
  assert.equal(handle.counts().messages, 1, 'a conflicting replay changes no state')
  handle.close()
})

test('an honest retry must not be punished for minting a fresh message id', () => {
  // M1 folded the producer-supplied messageId into the immutable hash, so a producer retrying
  // after an uncertain enqueue got IDEMPOTENCY_CONFLICT for a semantically identical message.
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  const first = handle.enqueue('s1', msg({ idempotencyKey: 'retry' }))
  const retry = handle.enqueue('s1', msg({ idempotencyKey: 'retry' }))
  assert.equal(retry.messageId, first.messageId)
  handle.close()
})

test('unkeyed messages coexist without limit', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  for (let i = 0; i < 5; i++) handle.enqueue('s1', msg())
  assert.equal(handle.counts().messages, 5)
  handle.close()
})

// ---------------------------------------------------------------- FIFO

test('FIFO order, and null means exactly one thing', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.enqueue('s1', msg({ body: body('A') }))
  handle.enqueue('s1', msg({ body: body('B') }))
  assert.equal(Buffer.from(handle.dequeue('s1').body).toString(), 'A')
  assert.equal(Buffer.from(handle.dequeue('s1').body).toString(), 'B')
  assert.equal(handle.dequeue('s1'), null, 'null is empty-queue-on-an-active-address and nothing else')
  assert.equal(handle.readMessages('s1').length, 2)
  assert.deepEqual(handle.readMessages('s1').map(m => m.dequeuedAtMs !== null), [true, true])
  handle.close()
})

test('readMessages cursor is stable and validated', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  handle.initialize('s2')
  const a = handle.enqueue('s1', msg({ body: body('a') }))
  handle.enqueue('s2', msg({ body: body('other-session') }))
  const b = handle.enqueue('s1', msg({ body: body('b') }))
  assert.ok(b.enqueueSeq > a.enqueueSeq)
  assert.deepEqual(handle.readMessages('s1', a.enqueueSeq).map(m => Buffer.from(m.body).toString()), ['b'])
  assert.equal(handle.readMessages('s1', b.enqueueSeq).length, 0)
  assert.equal(codeOf(() => handle.readMessages('s1', -1)), 'PROTOCOL_CURSOR_INVALID')
  assert.equal(codeOf(() => handle.readMessages('s1', 1.5)), 'PROTOCOL_CURSOR_INVALID')
  handle.close()
})

// ---------------------------------------------------------------- bounds

test('size ceilings are enforced before any write', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ body: Buffer.alloc(1048577) }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(handle.enqueue('s1', msg({ body: Buffer.alloc(1048576) })).enqueueSeq > 0, true)
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ kind: '' }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ kind: 'k'.repeat(65) }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ headers: { k: 'v'.repeat(4097) } }))), 'PROTOCOL_MESSAGE_INVALID')
  const many = {}
  for (let i = 0; i < 65; i++) many['h' + i] = 'v'
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ headers: many }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(codeOf(() => handle.enqueue('s1', msg({ idempotencyKey: 'k'.repeat(257) }))), 'PROTOCOL_MESSAGE_INVALID')
  assert.equal(handle.counts().messages, 1)
  handle.close()
})

// ---------------------------------------------------------------- migrations

test('each migration checksums only its own bytes', () => {
  assert.ok(MIGRATIONS.length >= 1)
  for (const m of MIGRATIONS) {
    assert.equal(m.checksum, createHash('sha256').update(Buffer.from(m.sql, 'utf8')).digest('hex'))
  }
  // Appending a future migration must not disturb an earlier one's checksum.
  const first = MIGRATIONS[0]
  const recomputed = createHash('sha256').update(Buffer.from(first.sql, 'utf8')).digest('hex')
  assert.equal(recomputed, first.checksum)
})

test('migration replay against an already-migrated database is a no-op', () => {
  const path = freshDb()
  const a = openProtocol(path); a.initialize('s1'); a.close()
  const b = openProtocol(path)
  assert.equal(b.initialize('s1').sessionId, 's1')
  b.close()
  const raw = rawOpen(path)
  assert.equal(raw.prepare("SELECT count(*) AS c FROM schema_migrations WHERE component='session-protocol'").get().c, MIGRATIONS.length)
  raw.close()
})

test('a rewritten migration checksum fails before any protocol read or write', () => {
  const path = freshDb()
  openProtocol(path).close()
  const raw = rawOpen(path)
  raw.prepare("UPDATE schema_migrations SET checksum='deadbeef' WHERE component='session-protocol' AND version=1").run()
  raw.close()
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH')
})

test('a future schema generation is refused rather than half-understood', () => {
  const path = freshDb()
  openProtocol(path).close()
  const raw = rawOpen(path)
  raw.prepare("INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES('session-protocol',9999,'x',1)").run()
  raw.close()
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED')
})

test('protocol tables the registry does not account for are a loud inconsistency', () => {
  const path = freshDb()
  openProtocol(path).close()
  const raw = rawOpen(path)
  raw.prepare("DELETE FROM schema_migrations WHERE component='session-protocol' AND version=1").run()
  raw.close()
  // Replaying the DDL over live tables, or half-migrating, would both be worse than refusing.
  assert.equal(codeOf(() => openProtocol(path)), 'PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT')
})

test('an adopter component may share schema_migrations without colliding', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.close()
  const raw = rawOpen(path)
  raw.prepare("INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES('adopter-topology',1,'abc',1)").run()
  raw.close()
  const again = openProtocol(path)
  again.initialize('s1')
  again.close()
})

// ---------------------------------------------------------------- read-only

test('a read-only handle reads and refuses every write', () => {
  const path = freshDb()
  const w = openProtocol(path)
  w.initialize('s1')
  w.enqueue('s1', msg())
  w.close()
  const ro = openProtocol(path, { readOnly: true })
  assert.equal(ro.listPending('s1').length, 1)
  assert.equal(ro.readMessages('s1').length, 1)
  assert.equal(codeOf(() => ro.enqueue('s1', msg())), 'PROTOCOL_DATABASE_READONLY')
  assert.equal(codeOf(() => ro.dequeue('s1')), 'PROTOCOL_DATABASE_READONLY')
  assert.equal(codeOf(() => ro.initialize('s2')), 'PROTOCOL_DATABASE_READONLY')
  assert.equal(codeOf(() => ro.retire('s1')), 'PROTOCOL_DATABASE_READONLY')
  ro.close()
})

test('a read-only handle refuses an unmigrated database instead of guessing', () => {
  const root = freshRoot()
  const path = join(root, 'empty.sqlite')
  writeFileSync(path, '')
  assert.equal(codeOf(() => openProtocol(path, { readOnly: true })), 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED')
})

// ---------------------------------------------------------------- corruption

test('a corrupt database fails loudly and is never reported as an empty queue', () => {
  const path = freshDb()
  const w = openProtocol(path)
  w.initialize('s1')
  for (let i = 0; i < 200; i++) w.enqueue('s1', msg({ body: Buffer.alloc(400, i % 251) }))
  w.close()
  const bytes = readFileSync(path)
  bytes.fill(0x5a, 4096)
  writeFileSync(path, bytes)
  const code = codeOf(() => {
    const h = openProtocol(path)
    const pending = h.listPending('s1')
    h.close()
    assert.fail(`corrupt database answered with ${pending.length} pending rows`)
  })
  assert.ok(['PROTOCOL_DATABASE_CORRUPT', 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED'].includes(code), `got ${code}`)
})

// ---------------------------------------------------------------- transaction seam

test('the transaction body is synchronous only: a promise-returning callback is refused', () => {
  const handle = openProtocol(freshDb())
  handle.initialize('s1')
  assert.equal(codeOf(() => handle.withTransaction(async () => {})), 'PROTOCOL_TRANSACTION_INVALID')
  assert.equal(codeOf(() => handle.withTransaction(() => Promise.resolve(1))), 'PROTOCOL_TRANSACTION_INVALID')
  assert.equal(handle.counts().messages, 0)
  handle.close()
})

test('an adopter table mutation and enqueue commit or roll back together', () => {
  const path = freshDb()
  const handle = openProtocol(path)
  handle.initialize('s1')
  const raw = rawOpen(path)
  raw.exec('CREATE TABLE adopter_edges (id INTEGER PRIMARY KEY, note TEXT NOT NULL) STRICT')
  raw.close()

  handle.withTransaction(tx => {
    tx.exec("INSERT INTO adopter_edges(note) VALUES('kept')")
    tx.enqueue('s1', msg({ body: body('kept') }))
  })
  assert.equal(handle.counts().messages, 1)

  assert.throws(() => handle.withTransaction(tx => {
    tx.exec("INSERT INTO adopter_edges(note) VALUES('rolled-back')")
    tx.enqueue('s1', msg({ body: body('rolled-back') }))
    throw new Error('adopter aborted')
  }))
  assert.equal(handle.counts().messages, 1, 'the enqueue rolled back with the adopter row')
  const check = rawOpen(path)
  assert.deepEqual(check.prepare('SELECT note FROM adopter_edges').all().map(r => r.note), ['kept'])
  check.close()
  handle.close()
})

// ---------------------------------------------------------------- index proofs

test('every declared index is the one the planner actually uses', () => {
  const handle = openProtocol(freshDb())
  const plans = handle.queryPlans()
  assert.match(plans.dequeueHead, /USING INDEX protocol_messages_pending_fifo/)
  assert.doesNotMatch(plans.dequeueHead, /TEMP B-TREE/)
  assert.match(plans.listPending, /USING INDEX protocol_messages_pending_fifo/)
  assert.doesNotMatch(plans.listPending, /TEMP B-TREE/)
  assert.match(plans.readMessages, /USING INDEX protocol_messages_history/)
  assert.doesNotMatch(plans.readMessages, /TEMP B-TREE/)
  assert.match(plans.idempotencyLookup, /USING INDEX protocol_messages_idempotency/)
  handle.close()
})

// ---------------------------------------------------------------- filesystem gate

test('the network-filesystem deny list is a table, not a guess', () => {
  assert.equal(isRejectedFilesystemType(0xef53), false, 'ext4 is a local filesystem')
  assert.equal(isRejectedFilesystemType(0x6969), true, 'NFS')
  assert.equal(isRejectedFilesystemType(0xff534d42), true, 'CIFS')
  assert.equal(isRejectedFilesystemType(0xfe534d42), true, 'SMB2')
  assert.equal(isRejectedFilesystemType(0x01021997), true, '9P')
  assert.equal(isRejectedFilesystemType(0x65735546), false, 'FUSE is unclassifiable, so it is not denied on identity')
  assert.ok(NETWORK_FILESYSTEM_TYPES.every(e => typeof e.name === 'string' && Number.isInteger(e.type)))
})

// ---------------------------------------------------------------- busy

test('write contention surfaces as a loud busy error, never as an empty result', () => {
  const path = freshDb()
  const a = openProtocol(path, { busyTimeoutMs: 50 })
  a.initialize('s1')
  a.enqueue('s1', msg())
  a.close()
  const b = openProtocol(path, { busyTimeoutMs: 50 })
  // An unrelated connection holds the single write lock for the duration.
  const holder = rawOpen(path)
  holder.exec('PRAGMA busy_timeout=50')
  holder.exec('BEGIN IMMEDIATE')
  holder.prepare("INSERT INTO protocol_sessions(session_id,created_at_ms) VALUES('holder',1)").run()
  try {
    assert.equal(codeOf(() => b.enqueue('s1', msg({ body: body('blocked') }))), 'PROTOCOL_DATABASE_BUSY')
    assert.equal(codeOf(() => b.dequeue('s1')), 'PROTOCOL_DATABASE_BUSY')
    assert.equal(b.listPending('s1').length, 1, 'readers are not blocked in WAL mode')
  } finally {
    holder.exec('ROLLBACK'); holder.close(); b.close()
  }
})

// ---------------------------------------------------------------- unwritable

test('an unwritable database directory fails loudly at open', () => {
  const root = freshRoot()
  const dir = join(root, 'locked')
  mkdirSync(dir)
  chmodSync(dir, 0o500)
  try {
    assert.equal(codeOf(() => openProtocol(join(dir, 'protocol.sqlite'))), 'PROTOCOL_DATABASE_UNAVAILABLE')
  } finally { chmodSync(dir, 0o700) }
})
