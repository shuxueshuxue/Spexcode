import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSessionShortcut } from './sessionShortcuts.js'

const rows = [
  { type: 'zone', zone: 'run' },
  { type: 'row', s: { id: 'parent' }, expandable: true, expanded: false },
  { type: 'row', s: { id: 'next' }, expandable: false, expanded: false },
]
const key = (key, extra = {}) => ({ key, altKey: true, ctrlKey: false, metaKey: false, ...extra })

test('plain Option arrows move across visible session rows', () => {
  assert.deepEqual(resolveSessionShortcut(rows, 'parent', key('ArrowDown')), { type: 'move', id: 'next' })
  assert.deepEqual(resolveSessionShortcut(rows, 'next', key('ArrowUp')), { type: 'move', id: 'parent' })
})

test('Option-Shift arrows disclose only the selected parent', () => {
  assert.deepEqual(resolveSessionShortcut(rows, 'parent', key('ArrowDown', { shiftKey: true })), { type: 'expand', id: 'parent' })
  assert.deepEqual(resolveSessionShortcut([{ ...rows[0] }, { ...rows[1], expanded: true }, rows[2]], 'parent', key('ArrowUp', { shiftKey: true })), { type: 'collapse', id: 'parent' })
  assert.deepEqual(resolveSessionShortcut(rows, 'next', key('ArrowDown', { shiftKey: true })), { type: 'noop', id: 'next' })
})

test('browser modifier variants do not steal the arrows', () => {
  assert.equal(resolveSessionShortcut(rows, 'parent', key('ArrowDown', { ctrlKey: true })), null)
  assert.equal(resolveSessionShortcut(rows, 'parent', { key: 'ArrowDown', altKey: false }), null)
})
