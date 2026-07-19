import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionAncestorIds } from './session.js'

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
