import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { jsonMigrationFencePath, migrateJsonSessionRecords } from './migration.js'
import { openProjectSessionApplication } from './production.js'

const record = (id: string, status: string, parent: string | null = null) => ({
  session_id: id,
  governed: true,
  worktree_path: `/tmp/${id}`,
  branch: `node/${id}`,
  status,
  parent,
  createdAt: id === 'parent' ? 10 : 20,
})

test('JSON migration imports state, parent/watch topology, deterministic event, backup, and marker idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-migration-'))
  const recordsRoot = join(root, 'sessions')
  const databasePath = join(root, 'sessions.sqlite')
  mkdirSync(join(recordsRoot, 'parent'), { recursive: true })
  mkdirSync(join(recordsRoot, 'child'), { recursive: true })
  writeFileSync(join(recordsRoot, 'parent', 'session.json'), JSON.stringify(record('parent', 'active')))
  writeFileSync(join(recordsRoot, 'child', 'session.json'), JSON.stringify(record('child', 'awaiting', 'parent')))
  writeFileSync(join(recordsRoot, 'child', 'watchers.json'), JSON.stringify([{ watcher: 'parent', createdAt: '2026-01-01T00:00:00.000Z', sources: ['manual', 'parent'] }]))
  writeFileSync(join(recordsRoot, 'child', 'pending.json'), '[{"mid":"m","text":"queued","from":null,"attributes":{"channel":"note"}}]')
  writeFileSync(join(recordsRoot, 'child', 'timeline.ndjson'), '{"kind":"status","status":"active","proposal":null,"note":"old status","ts":"2026-01-01T00:00:00.000Z"}\n{"kind":"sent","mid":"sent-mid","text":"already recorded","from":null,"ts":"2026-01-01T00:01:00.000Z"}\n')
  writeFileSync(join(recordsRoot, 'child', 'cursors.json'), '{"version":1,"follows":{}}')
  const first = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(first.replayed, false)
  assert.equal(first.records, 2)
  assert.equal(first.parentEdges, 1)
  assert.equal(first.watchEdges, 2)
  assert.equal(existsSync(jsonMigrationFencePath(recordsRoot)), true)
  assert.equal(JSON.parse(readFileSync(jsonMigrationFencePath(recordsRoot), 'utf8')).state, 'retired')
  const retiredEnvelope = JSON.parse(readFileSync(join(recordsRoot, 'child', 'runtime.json'), 'utf8')) as Record<string, unknown>
  assert.equal(existsSync(join(recordsRoot, 'child', 'session.json')), false)
  assert.equal('status' in retiredEnvelope, false)
  assert.equal('proposal' in retiredEnvelope, false)
  assert.equal('note' in retiredEnvelope, false)
  assert.equal('parent' in retiredEnvelope, false)
  assert.equal(existsSync(join(recordsRoot, 'child', 'watchers.json')), false)
  assert.equal(existsSync(join(recordsRoot, 'child', 'pending.json')), false)
  assert.equal(existsSync(join(recordsRoot, 'child', 'timeline.ndjson')), false)
  assert.equal(existsSync(join(recordsRoot, 'child', 'cursors.json')), false)
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.deepEqual(app.readState('child'), { sessionId: 'child', status: 'awaiting', proposal: null, note: null, parentSessionId: 'parent', updatedAtMs: 20 })
  assert.equal(app.events.read('child').length, 4)
  assert.deepEqual(app.readMessageHistory('child').map(message => Buffer.from(message.body).toString('utf8')), ['queued'])
  assert.equal(app.readPendingMessages('child').length, 1)
  assert.equal(app.readEvents('child').filter(event => event.type === 'session.message.sent.v1').length, 2)
  assert.deepEqual(app.topology.recipients('child'), ['parent'])
  app.close()
  const second = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(second.replayed, true)
  assert.equal(second.sourceDigest, first.sourceDigest)
})

test('JSON migration refuses a pre-existing fence instead of racing another cutover', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-migration-fenced-'))
  const recordsRoot = join(root, 'sessions')
  mkdirSync(join(recordsRoot, 'one'), { recursive: true })
  writeFileSync(join(recordsRoot, 'one', 'session.json'), JSON.stringify(record('one', 'active')))
  writeFileSync(jsonMigrationFencePath(recordsRoot), '{"version":1,"state":"migrating"}\n', { flag: 'wx' })
  assert.throws(
    () => migrateJsonSessionRecords({ databasePath: join(root, 'sessions.sqlite'), recordsRoot, locality: () => {} }),
    /migration fence already exists/,
  )
})

test('JSON migration refuses an orphan parent by default before SQLite cutover', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-migration-fail-'))
  const recordsRoot = join(root, 'sessions')
  mkdirSync(join(recordsRoot, 'a'), { recursive: true })
  writeFileSync(join(recordsRoot, 'a', 'session.json'), JSON.stringify(record('a', 'active', 'missing')))
  assert.throws(() => migrateJsonSessionRecords({ databasePath: join(root, 'sessions.sqlite'), recordsRoot, locality: () => {} }), /retired parents.*missing.*orphanParentPolicy=tombstone/)
})

test('JSON migration tombstones an orphan parent and normalizes empty root markers', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-migration-tombstone-'))
  const recordsRoot = join(root, 'sessions')
  const databasePath = join(root, 'sessions.sqlite')
  mkdirSync(join(recordsRoot, 'root'), { recursive: true })
  mkdirSync(join(recordsRoot, 'child'), { recursive: true })
  writeFileSync(join(recordsRoot, 'root', 'session.json'), JSON.stringify(record('root', 'active', '')))
  writeFileSync(join(recordsRoot, 'child', 'session.json'), JSON.stringify(record('child', 'awaiting', 'retired-parent')))
  const first = migrateJsonSessionRecords({
    databasePath,
    recordsRoot,
    orphanParentPolicy: 'tombstone',
    locality: () => {},
  })
  assert.deepEqual(first.orphanParents, ['retired-parent'])
  assert.equal(first.records, 2)
  assert.equal(first.parentEdges, 1)
  assert.equal(first.events, 3)
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.deepEqual(app.readState('root'), { sessionId: 'root', status: 'active', proposal: null, note: null, parentSessionId: null, updatedAtMs: 20 })
  assert.deepEqual(app.readState('retired-parent'), { sessionId: 'retired-parent', status: 'archived', proposal: null, note: null, parentSessionId: null, updatedAtMs: 0 })
  assert.deepEqual(app.readState('child'), { sessionId: 'child', status: 'awaiting', proposal: null, note: null, parentSessionId: 'retired-parent', updatedAtMs: 20 })
  assert.equal(app.topology.recipients('child').includes('retired-parent'), true)
  app.close()
  const second = migrateJsonSessionRecords({ databasePath, recordsRoot, orphanParentPolicy: 'tombstone', locality: () => {} })
  assert.equal(second.replayed, true)
  assert.deepEqual(second.orphanParents, ['retired-parent'])
})
