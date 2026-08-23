import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionAncestorIds, sessionDisplayState, sessionFooterState, sessionForest, sessionPresentationOrder, sessionZone, STATUS_COLOR, STATUS_GLYPH } from './session.js'

test('one display projection keeps liveness, zone, and row glyph aligned', () => {
  const cases = [
    { session: { status: 'asking', liveness: 'online' }, zone: 'need', glyph: STATUS_GLYPH.asking, status: 'asking' },
    { session: { status: 'working', liveness: 'online' }, zone: 'run', glyph: STATUS_GLYPH.working, status: 'working' },
    { session: { status: 'asking', liveness: 'offline' }, zone: 'offline', glyph: STATUS_GLYPH.offline, status: 'offline' },
    { session: { status: 'working', liveness: 'offline' }, zone: 'offline', glyph: STATUS_GLYPH.offline, status: 'offline' },
    { session: { status: 'retired', liveness: 'offline' }, zone: 'offline', glyph: STATUS_GLYPH.retired, status: 'retired' },
    { session: { status: 'queued', liveness: 'offline' }, zone: 'run', glyph: STATUS_GLYPH.queued, status: 'queued' },
  ]
  for (const { session, zone, glyph, status } of cases) {
    assert.equal(sessionZone(session), zone)
    assert.deepEqual(sessionDisplayState(session), {
      zone, status, color: STATUS_COLOR[status], glyph,
    })
  }
  assert.equal(sessionDisplayState({ archived: true, status: 'working', liveness: 'online' }).status, 'offline')
  assert.equal(sessionDisplayState({ archived: true, status: 'working', liveness: 'online' }).glyph, STATUS_GLYPH.offline)
})

test('forest starts a new zone root when a child outlives its parent process', () => {
  const items = sessionForest([
    { id: 'parent', status: 'asking', liveness: 'online', sortKey: 20 },
    { id: '66019e9b', parent: 'parent', status: 'asking', liveness: 'offline', sortKey: 30 },
  ], () => true)
  assert.deepEqual(items.filter((item) => item.type === 'zone').map((item) => item.zone), ['need', 'offline'])
  const child = items.find((item) => item.type === 'row' && item.s.id === '66019e9b')
  assert.equal(child.depth, 0)
  assert.equal(items.find((item) => item.type === 'zone' && item.zone === 'offline').count, 1)
})

test('footer state keeps queued live and archived ahead of offline', () => {
  assert.equal(sessionFooterState({ status: 'queued', liveness: 'offline' }), 'live')
  assert.equal(sessionFooterState({ status: 'offline', liveness: 'offline' }), 'offline')
  assert.equal(sessionFooterState({ status: 'offline', liveness: 'online' }), 'offline')
  assert.equal(sessionFooterState({ archived: true, status: 'offline', liveness: 'offline' }), 'archived')
})

test('session ancestor path reveals every present nesting parent', () => {
  const sessions = [
    { id: 'root' },
    { id: 'mid', parent: 'root' },
    { id: 'leaf', parent: 'mid' },
  ]

  assert.deepEqual(sessionAncestorIds(sessions, 'leaf'), ['mid', 'root'])
  assert.deepEqual(sessionAncestorIds(sessions, 'root'), [])
})

test('session ancestor path stops at missing parents and malformed cycles', () => {
  const sessions = [
    { id: 'orphan', parent: 'gone' },
    { id: 'a', parent: 'b' },
    { id: 'b', parent: 'a' },
  ]

  assert.deepEqual(sessionAncestorIds(sessions, 'orphan'), [])
  assert.deepEqual(sessionAncestorIds(sessions, 'a'), ['b'])
  assert.deepEqual(sessionAncestorIds(sessions, 'missing'), [])
})

test('presentation order keeps dashboard zones and recursive parent-before-child order', () => {
  const sessions = [
    { id: 'run-old', status: 'working', sortKey: 10 },
    { id: 'need-parent', status: 'asking', sortKey: 20 },
    { id: 'need-child', parent: 'need-parent', status: 'done', sortKey: 100 },
    { id: 'need-new', status: 'review', sortKey: 30 },
    { id: 'run-new', status: 'parked', sortKey: 40 },
    { id: 'offline', status: 'offline', liveness: 'offline', sortKey: 50 },
  ]

  assert.deepEqual(
    sessionPresentationOrder(sessions).map((session) => session.id),
    ['need-new', 'need-parent', 'need-child', 'run-new', 'run-old', 'offline'],
  )
})
