import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionAncestorIds, sessionPresentationOrder } from './session.js'

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
