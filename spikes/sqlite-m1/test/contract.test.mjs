import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openProtocol, ProtocolError } from '../protocol.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'sqlite-m1-test-'))
const message = (sessionId, id, body, extra = {}) => ({ protocolVersion: 1, messageId: id, targetSessionId: sessionId, body, ...extra })
const code = (fn) => { try { fn() } catch (error) { return error instanceof ProtocolError ? error.code : error.code || error.message } return null }

test('rejects relative paths and keeps an explicit absolute databasePath', () => {
  assert.equal(code(() => openProtocol('relative.db')), 'INVALID_PATH')
  const root = temp(); const path = resolve(root, 'state.sqlite')
  const protocol = openProtocol(path); assert.equal(protocol.databasePath, path); protocol.close(); rmSync(root, { recursive: true, force: true })
})

test('FIFO, immutable history, exact idempotency, opaque bytes, and retirement', () => {
  const root = temp(); const path = join(root, 'state.sqlite'); const p = openProtocol(path); const s = 'session-a'; p.initialize(s)
  const a = p.enqueue(s, message(s, 'a', Uint8Array.from([0, 255, 1]), { headers: { z: 'last', a: 'first' }, idempotencyKey: 'k-a' }))
  const replay = p.enqueue(s, message(s, 'a', Uint8Array.from([0, 255, 1]), { headers: { a: 'first', z: 'last' }, idempotencyKey: 'k-a' }))
  assert.equal(replay.messageId, 'a'); assert.equal(p.listPending(s).length, 1)
  assert.equal(code(() => p.enqueue(s, message(s, 'a2', 'changed', { idempotencyKey: 'k-a', headers: { a: 'changed' } }))), 'IDEMPOTENCY_CONFLICT')
  p.enqueue(s, message(s, 'b', 'B'))
  assert.deepEqual(p.listPending(s).map(m => m.messageId), ['a', 'b'])
  assert.equal(p.dequeue(s).messageId, 'a'); assert.equal(p.dequeue(s).messageId, 'b'); assert.equal(p.dequeue(s), null)
  const history = p.readMessages(s); assert.deepEqual(history.map(m => [m.messageId, m.state]), [['a', 'dequeued'], ['b', 'dequeued']]); assert.deepEqual([...history[0].body], [0, 255, 1])
  assert.deepEqual(p.retire(s), { sessionId: s, state: 'retired' }); assert.equal(code(() => p.initialize(s)), 'RETIRED'); assert.equal(code(() => p.enqueue(s, message(s, 'c', 'C'))), 'RETIRED')
  assert.deepEqual(p.readMessages(s).map(m => m.messageId), ['a', 'b']); p.close(); rmSync(root, { recursive: true, force: true })
})

test('unknown target and non-empty retirement fail without mutation', () => {
  const root = temp(); const p = openProtocol(join(root, 'state.sqlite')); const s = 'unknown-test'
  assert.equal(code(() => p.enqueue(s, message(s, 'x', 'x'))), 'UNKNOWN_SESSION')
  p.initialize(s); p.enqueue(s, message(s, 'x', 'x')); assert.equal(code(() => p.retire(s)), 'NON_EMPTY_RETIRE'); assert.equal(p.listPending(s).length, 1); p.close(); rmSync(root, { recursive: true, force: true })
})

test('same-database extension transaction commits or rolls back with enqueue', () => {
  const root = temp(); const p = openProtocol(join(root, 'state.sqlite')); const s = 'extension'; p.initialize(s)
  p.withTransaction(tx => { tx.exec('CREATE TABLE extension_state (id TEXT PRIMARY KEY, value TEXT NOT NULL)'); tx.exec('INSERT INTO extension_state VALUES (?, ?)', 'one', 'committed'); tx.enqueue(s, message(s, 'committed', 'yes')) })
  assert.equal(p.listPending(s)[0].messageId, 'committed')
  assert.equal(code(() => p.withTransaction(tx => { tx.exec('INSERT INTO extension_state VALUES (?, ?)', 'two', 'rolled-back'); tx.enqueue(s, message(s, 'rolled-back', 'no')); throw new Error('forced rollback') })), 'SQLITE')
  assert.deepEqual(p.readMessages(s).map(m => m.messageId), ['committed']); assert.equal(p.listPending(s).length, 1); p.close(); rmSync(root, { recursive: true, force: true })
})

test('migration checksum and future schema fail loudly', () => {
  const root = temp(); const path = join(root, 'state.sqlite'); let p = openProtocol(path); p.initialize('m'); p.close()
  let db = new DatabaseSync(path); db.prepare("UPDATE protocol_meta SET value='bad' WHERE key='schema_checksum'").run(); db.close(); assert.equal(code(() => openProtocol(path)), 'SCHEMA_CHECKSUM')
  db = new DatabaseSync(path); db.prepare("UPDATE protocol_meta SET value='1' WHERE key='schema_checksum'").run(); db.prepare("UPDATE protocol_meta SET value='999' WHERE key='schema_version'").run(); db.close(); assert.equal(code(() => openProtocol(path)), 'SCHEMA_UNSUPPORTED'); rmSync(root, { recursive: true, force: true })
})
