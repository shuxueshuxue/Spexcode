import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { migrateJsonSessionRecords } from './migration.js'
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
  const first = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(first.replayed, false)
  assert.equal(first.records, 2)
  assert.equal(first.parentEdges, 1)
  assert.equal(first.watchEdges, 1)
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.deepEqual(app.readState('child'), { sessionId: 'child', status: 'awaiting', parentSessionId: 'parent', updatedAtMs: 20 })
  assert.equal(app.events.read('child').length, 1)
  assert.deepEqual(app.topology.recipients('child'), ['parent'])
  app.close()
  const second = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(second.replayed, true)
  assert.equal(second.sourceDigest, first.sourceDigest)
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
  assert.deepEqual(app.readState('root'), { sessionId: 'root', status: 'active', parentSessionId: null, updatedAtMs: 20 })
  assert.deepEqual(app.readState('retired-parent'), { sessionId: 'retired-parent', status: 'archived', parentSessionId: null, updatedAtMs: 0 })
  assert.deepEqual(app.readState('child'), { sessionId: 'child', status: 'awaiting', parentSessionId: 'retired-parent', updatedAtMs: 20 })
  assert.equal(app.topology.recipients('child').includes('retired-parent'), true)
  app.close()
  const second = migrateJsonSessionRecords({ databasePath, recordsRoot, orphanParentPolicy: 'tombstone', locality: () => {} })
  assert.equal(second.replayed, true)
  assert.deepEqual(second.orphanParents, ['retired-parent'])
})
