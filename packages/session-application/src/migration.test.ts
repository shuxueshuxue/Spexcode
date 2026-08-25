import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { jsonMigrationFencePath, legacyResidueExists, migrateJsonSessionRecords, MIGRATED_MESSAGE_EVENT, MIGRATED_STATE_EVENT } from './migration.js'
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
  // Legacy history lands under its own ignorable types; the pending debt's sent line is a live message fact.
  assert.deepEqual(app.readEvents('child').map(event => [event.type, event.ignorable]), [
    ['session.state.changed.v1', false],
    ['session.state.migrated.v1', true],
    ['session.message.migrated.v1', true],
    ['session.message.sent.v1', false],
  ])
  assert.equal(app.replayState('child')?.status, 'awaiting')
  assert.deepEqual(app.topology.recipients('child'), ['parent'])
  app.close()
  const second = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(second.replayed, true)
  assert.equal(second.sourceDigest, first.sourceDigest)
})

test('JSON migration refuses a lifecycle-less legacy envelope before any marker exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-migration-nolifecycle-'))
  const recordsRoot = join(root, 'sessions')
  mkdirSync(join(recordsRoot, 'bare'), { recursive: true })
  writeFileSync(join(recordsRoot, 'bare', 'session.json'), JSON.stringify({ session_id: 'bare', governed: true }))
  assert.throws(() => migrateJsonSessionRecords({ databasePath: join(root, 'sessions.sqlite'), recordsRoot, locality: () => {} }), /carries no lifecycle; only a marked store may hold a retired envelope/)
  assert.equal(existsSync(join(root, 'sessions.sqlite')), false)
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

// A store cut over by an importer that only copied state: one deterministic state event per row, no history,
// no pending, and a marker whose backup holds nothing but envelopes. This is the production shape the residue
// path exists for.
function oldImporterStore(root: string, rows: Array<{ id: string; status: string; parent?: string | null }>): { recordsRoot: string; databasePath: string } {
  const recordsRoot = join(root, 'sessions')
  const databasePath = join(root, 'sessions.sqlite')
  mkdirSync(recordsRoot, { recursive: true })
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  for (const row of rows) app.createSession({ sessionId: row.id, status: row.status, parentSessionId: row.parent ?? null, updatedAtMs: 1_000 })
  app.close()
  writeFileSync(`${databasePath}.json-migration.json`, JSON.stringify({ version: 1, sourceDigest: 'old-importer', records: rows.length, parentEdges: 0, watchEdges: 0, events: rows.length, orphanParents: [], backupRoot: join(root, 'old-backup'), markerPath: `${databasePath}.json-migration.json`, replayed: false }) + '\n')
  writeFileSync(jsonMigrationFencePath(recordsRoot), JSON.stringify({ version: 1, state: 'retired', sourceDigest: 'old-importer', pid: 1 }) + '\n')
  return { recordsRoot, databasePath }
}

const line = (event: Record<string, unknown>) => JSON.stringify(event) + '\n'

test('a marked store absorbs legacy residue once: history, watch edges, pending debt, and envelopes are migrated then retired', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-residue-'))
  const { recordsRoot, databasePath } = oldImporterStore(root, [{ id: 'live', status: 'awaiting' }, { id: 'watcher', status: 'active' }, { id: 'retired-only', status: 'active' }])
  // (1) legacy envelope for a row the old importer already copied: canonical status wins, history is absorbed
  mkdirSync(join(recordsRoot, 'live', 'timeline'), { recursive: true })
  writeFileSync(join(recordsRoot, 'live', 'session.json'), JSON.stringify({ ...record('live', 'active'), createdAt: 500 }))
  writeFileSync(join(recordsRoot, 'live', 'timeline', '000000000001.ndjson'),
    line({ kind: 'status', status: 'active', proposal: null, note: 'launched', ts: '2026-01-01T00:00:00.000Z' })
    + line({ kind: 'dispatch-settled', mid: 'ignored' })
    + line({ kind: 'sent', mid: 'old-mid', text: 'old mail', from: 'watcher', ts: '2026-01-01T00:00:01.000Z' }))
  writeFileSync(join(recordsRoot, 'live', 'watchers.json'), JSON.stringify([{ watcher: 'watcher', createdAt: '2026-01-01T00:00:00.000Z', sources: ['parent'] }]))
  writeFileSync(join(recordsRoot, 'live', 'pending.json'), JSON.stringify([{ mid: 'debt-mid', text: 'still owed', from: 'watcher' }]))
  writeFileSync(join(recordsRoot, 'live', 'cursors.json'), JSON.stringify({ version: 1, follows: { watcher: 3 } }))
  // (2) a retired envelope whose row exists: only its leftover artifacts are absorbed
  mkdirSync(join(recordsRoot, 'retired-only'), { recursive: true })
  writeFileSync(join(recordsRoot, 'retired-only', 'runtime.json'), JSON.stringify({ session_id: 'retired-only', governed: true, createdAt: 700 }))
  writeFileSync(join(recordsRoot, 'retired-only', 'timeline.ndjson'), line({ kind: 'status', status: 'active', proposal: null, note: null }))
  // (2b) the legacy name carrying only runtime metadata — a post-cutover writer's envelope — is a retired envelope
  mkdirSync(join(recordsRoot, 'watcher', 'timeline'), { recursive: true })
  writeFileSync(join(recordsRoot, 'watcher', 'session.json'), JSON.stringify({ session_id: 'watcher', governed: true, worktree_path: '/tmp/watcher', branch: 'node/watcher', createdAt: 900 }))
  writeFileSync(join(recordsRoot, 'watcher', 'timeline', '000000000001.ndjson'), line({ kind: 'status', status: 'active', proposal: null, note: 'renamed later' }))
  // (3) a legacy envelope the old importer never saw: its row is created from the envelope
  mkdirSync(join(recordsRoot, 'unseen'), { recursive: true })
  writeFileSync(join(recordsRoot, 'unseen', 'session.json'), JSON.stringify(record('unseen', 'asking', 'live')))
  // (4) a directory nothing claims: a fixture that leaked into the store is not a session
  mkdirSync(join(recordsRoot, 'timeline-parent-test', 'timeline'), { recursive: true })
  writeFileSync(join(recordsRoot, 'timeline-parent-test', 'timeline', '000000000001.ndjson'), line({ kind: 'status', status: 'error', proposal: null, note: 'fixture' }))
  writeFileSync(join(recordsRoot, 'timeline-parent-test', 'pending.json'), JSON.stringify([{ mid: 'fixture-mid', text: 'fixture', from: null }]))
  // (5) a sentinel-only directory with nothing legacy in it is not residue
  mkdirSync(join(recordsRoot, 'sentinel-only'), { recursive: true })
  writeFileSync(join(recordsRoot, 'sentinel-only', 'spec-checked'), '')
  assert.equal(legacyResidueExists(recordsRoot), true)

  const report = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(report.replayed, true)
  assert.equal(report.sourceDigest, 'old-importer')
  assert.deepEqual({ ...report.residue, sourceDigest: undefined, backupRoot: undefined }, { records: 1, events: 6, watchEdges: 1, pending: 1, unclaimed: ['timeline-parent-test'], sourceDigest: undefined, backupRoot: undefined })
  assert.equal(report.residue?.backupRoot.startsWith(join(root, 'old-backup', 'residue')), true)
  assert.equal(existsSync(join(report.residue!.backupRoot, 'live', 'timeline', '000000000001.ndjson')), true)
  assert.equal(existsSync(join(report.residue!.backupRoot, 'timeline-parent-test', 'pending.json')), true)
  assert.equal(legacyResidueExists(recordsRoot), false)
  assert.deepEqual(readdirSync(join(recordsRoot, 'live')).sort(), ['runtime.json'])
  const envelope = JSON.parse(readFileSync(join(recordsRoot, 'live', 'runtime.json'), 'utf8')) as Record<string, unknown>
  assert.equal(envelope.createdAt, 500)
  for (const field of ['status', 'proposal', 'note', 'parent']) assert.equal(field in envelope, false)
  assert.deepEqual(readdirSync(join(recordsRoot, 'timeline-parent-test')), [])
  assert.deepEqual(readdirSync(join(recordsRoot, 'watcher')), ['runtime.json'])
  assert.equal((JSON.parse(readFileSync(join(recordsRoot, 'watcher', 'runtime.json'), 'utf8')) as Record<string, unknown>).createdAt, 900)
  assert.equal(JSON.parse(readFileSync(jsonMigrationFencePath(recordsRoot), 'utf8')).state, 'retired')

  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  // canonical state stays authoritative for a row the old importer copied; the stale envelope did not rewrite it
  assert.equal(app.readState('live')?.status, 'awaiting')
  assert.equal(app.replayState('live')?.status, 'awaiting')
  assert.deepEqual(app.readEvents('live').map(event => [event.type, event.ignorable, event.occurredAtMs]), [
    ['session.state.changed.v1', false, 1_000],
    [MIGRATED_STATE_EVENT, true, Date.parse('2026-01-01T00:00:00.000Z')],
    [MIGRATED_MESSAGE_EVENT, true, Date.parse('2026-01-01T00:00:01.000Z')],
    ['session.message.sent.v1', false, app.readEvents('live')[3]!.occurredAtMs],
  ])
  // the legacy debt is queued once; the creation of `unseen` under this parent adds its own notification row
  assert.deepEqual(app.readPendingMessages('live').filter(message => message.kind === 'session.prompt.v1').map(message => Buffer.from(message.body).toString('utf8')), ['still owed'])
  assert.deepEqual(app.topology.parents('live', 'watch:parent').map(edge => edge.fromSessionId), ['watcher'])
  assert.equal(app.readEvents('retired-only').filter(event => event.type === MIGRATED_STATE_EVENT).length, 1)
  assert.equal(app.readEvents('watcher').filter(event => event.type === MIGRATED_STATE_EVENT).length, 1)
  assert.equal(app.readState('watcher')?.status, 'active')
  assert.deepEqual(app.readState('unseen'), { sessionId: 'unseen', status: 'asking', proposal: null, note: null, parentSessionId: 'live', updatedAtMs: 20 })
  assert.equal(app.readState('timeline-parent-test'), null)
  assert.equal(app.readState('sentinel-only'), null)
  const eventsAfterFirst = ['live', 'retired-only', 'unseen', 'watcher'].map(id => app.readEvents(id).length)
  app.close()

  // Repeated start: a settled tree is a no-op and appends nothing.
  const again = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(again.residue, undefined)
  const reopened = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.deepEqual(['live', 'retired-only', 'unseen', 'watcher'].map(id => reopened.readEvents(id).length), eventsAfterFirst)
  reopened.close()
})

test('residue migration is re-entrant: an interrupted retire resumes without duplicating any event or queue row', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-residue-reentry-'))
  const { recordsRoot, databasePath } = oldImporterStore(root, [{ id: 'live', status: 'awaiting' }])
  mkdirSync(join(recordsRoot, 'live', 'timeline'), { recursive: true })
  writeFileSync(join(recordsRoot, 'live', 'timeline', '000000000001.ndjson'), line({ kind: 'status', status: 'active', proposal: null, note: 'one', ts: '2026-01-01T00:00:00.000Z' }) + line({ kind: 'sent', mid: 'm1', text: 'hello', from: null, ts: '2026-01-01T00:00:01.000Z' }))
  writeFileSync(join(recordsRoot, 'live', 'pending.json'), JSON.stringify([{ mid: 'debt', text: 'owed', from: null }]))
  // The import lands, then retire cannot unlink anything in the session directory: the process dies with the
  // tree intact and the store already carrying the history and the queue row.
  chmodSync(join(recordsRoot, 'live'), 0o500)
  try {
    assert.throws(() => migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} }), /EACCES|EPERM/)
  } finally {
    chmodSync(join(recordsRoot, 'live'), 0o700)
  }
  assert.equal(legacyResidueExists(recordsRoot), true)
  const partial = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.equal(partial.readEvents('live').length, 4)
  assert.equal(partial.readPendingMessages('live').length, 1)
  partial.close()
  const resumed = migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  assert.equal(resumed.residue?.events, 0)
  assert.equal(resumed.residue?.pending, 1)
  assert.equal(legacyResidueExists(recordsRoot), false)
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.equal(app.readEvents('live').length, 4)
  assert.equal(app.readPendingMessages('live').length, 1)
  assert.equal(app.readMessageHistory('live').length, 1)
  app.close()
})

test('residue history keeps every stored follow cursor pointing past what its watcher already consumed', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-residue-cursor-'))
  const { recordsRoot, databasePath } = oldImporterStore(root, [{ id: 'subject', status: 'active' }, { id: 'watcher', status: 'active' }])
  const seed = openProjectSessionApplication({ databasePath, locality: () => {} })
  // three live projected events (create at 1_000, then two transitions) and a watcher that consumed the first two
  seed.transitionSession('subject', { status: 'awaiting', proposal: 'merge' })
  seed.transitionSession('subject', { status: 'active' })
  const live = seed.readEvents('subject')
  assert.equal(live.length, 3)
  seed.advanceFollowCursor('watcher', 'subject', 2)
  seed.close()
  const boundary = live[1]!.occurredAtMs
  mkdirSync(join(recordsRoot, 'subject'), { recursive: true })
  writeFileSync(join(recordsRoot, 'subject', 'timeline.ndjson'),
    line({ kind: 'status', status: 'created', proposal: null, note: null, ts: new Date(boundary - 2_000).toISOString() })
    + line({ kind: 'sent', mid: 'older', text: 'before the cursor', from: null, ts: new Date(boundary - 1_000).toISOString() })
    + line({ kind: 'sent', mid: 'newer', text: 'after the cursor', from: null, ts: new Date(boundary + 1_000_000).toISOString() }))
  migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} })
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  // two history lines now sort before the consumed boundary; the one after it stays unread
  assert.equal(app.readFollowCursor('watcher', 'subject'), 4)
  const projected = [...app.readEvents('subject')].sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.eventSeq - b.eventSeq)
  assert.deepEqual(projected.slice(0, 4).map(event => event.type), ['session.state.changed.v1', MIGRATED_STATE_EVENT, MIGRATED_MESSAGE_EVENT, 'session.state.changed.v1'])
  assert.equal(projected[5]!.type, MIGRATED_MESSAGE_EVENT)
  app.close()
})

test('residue migration refuses a retired envelope with no canonical row instead of inventing state', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-json-residue-orphan-'))
  const { recordsRoot, databasePath } = oldImporterStore(root, [{ id: 'live', status: 'active' }])
  mkdirSync(join(recordsRoot, 'ghost'), { recursive: true })
  writeFileSync(join(recordsRoot, 'ghost', 'runtime.json'), JSON.stringify({ session_id: 'ghost', governed: true }))
  writeFileSync(join(recordsRoot, 'ghost', 'timeline.ndjson'), line({ kind: 'status', status: 'active', proposal: null, note: null }))
  assert.throws(() => migrateJsonSessionRecords({ databasePath, recordsRoot, locality: () => {} }), /retired envelope .*ghost\/runtime\.json has no canonical application state/)
  assert.equal(existsSync(join(recordsRoot, 'ghost', 'timeline.ndjson')), true)
})
