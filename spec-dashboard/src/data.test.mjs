import test from 'node:test'
import assert from 'node:assert/strict'
import { layout } from './data.js'

const tree = [
  { id: 'root', parent: null },
  { id: 'a', parent: 'root' },
  { id: 'b', parent: 'root' },
  { id: 'a1', parent: 'a' },
  { id: 'a2', parent: 'a' },
  { id: 'b1', parent: 'b' },
  { id: 'a1x', parent: 'a1' },
]

test('two-layer frontier lays out both sibling branches at the focused depth', () => {
  const expanded = new Set(['root', 'a', 'b', 'a1', 'a2', 'b1'])
  const pos = layout(tree, expanded)
  assert.deepEqual(Object.keys(pos).sort(), ['a', 'a1', 'a1x', 'a2', 'b', 'b1', 'root'])
  assert.equal(pos.a.x, pos.b.x)
  assert.equal(pos.a1.x, pos.a2.x)
  assert.equal(pos.a1x.x > pos.a1.x, true)
})

test('adding a deeper expansion only adds nodes and preserves existing coordinates', () => {
  const before = layout(tree, new Set(['root', 'a', 'b']))
  const after = layout(tree, new Set(['root', 'a', 'b', 'a1', 'a2', 'b1']))
  for (const id of Object.keys(before)) assert.deepEqual(after[id], before[id])
})
