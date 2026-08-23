import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, singleLayerFrontier, X_GAP, Y_GAP } from './data.js'

const tree = [
  { id: 'root', parent: null },
  { id: 'a', parent: 'root' },
  { id: 'b', parent: 'root' },
  { id: 'a1', parent: 'a' },
  { id: 'a2', parent: 'a' },
  { id: 'b1', parent: 'b' },
  { id: 'a1x', parent: 'a1' },
]

test('single-layer frontier opens only the focused branch', () => {
  const expanded = new Set(['root', 'a'])
  const pos = layout(tree, expanded)
  assert.deepEqual(Object.keys(pos).sort(), ['a', 'a1', 'a2', 'b', 'root'])
  assert.equal(pos.a.x, pos.b.x)
  assert.equal(pos.a1.x, pos.a2.x)
  assert.equal(pos.a1.x > pos.a.x, true)
  assert.equal(pos.b1, undefined)
  assert.equal(pos.a1x, undefined)
})

test('adding a deeper expansion only adds nodes and preserves existing coordinates', () => {
  const before = layout(tree, new Set(['root', 'a', 'b']))
  const after = layout(tree, new Set(['root', 'a', 'b', 'a1', 'a2', 'b1']))
  for (const id of Object.keys(before)) assert.deepEqual(after[id], before[id])
})

test('wide sibling child blocks reserve the next-layer total height', () => {
  const tree = [
    { id: 'root', parent: null }, { id: 'left', parent: 'root' }, { id: 'right', parent: 'root' },
    { id: 'l1', parent: 'left' }, { id: 'l2', parent: 'left' }, { id: 'l3', parent: 'left' },
    { id: 'r1', parent: 'right' }, { id: 'r2', parent: 'right' }, { id: 'r3', parent: 'right' },
  ]
  const pos = layout(tree, new Set(tree.map((node) => node.id)))
  const left = tree.filter((node) => node.parent === 'left')
  const right = tree.filter((node) => node.parent === 'right')
  for (const a of left) for (const b of right) assert.ok(Math.abs(pos[a.id].y - pos[b.id].y) >= 50)
})

test('every focus stop exposes exactly its ancestor spine and immediate children', () => {
  for (const focus of tree) {
    const expanded = singleLayerFrontier(tree, focus.id)
    const expected = new Set()
    for (let node = focus; node; node = node.parent ? tree.find((candidate) => candidate.id === node.parent) : null) {
      expected.add(node.id)
    }
    const visible = new Set(Object.keys(layout(tree, expanded)))
    const expectedVisible = new Set(tree.filter((node) => !node.parent || expected.has(node.parent)).map((node) => node.id))
    assert.deepEqual(visible, expectedVisible, `focus ${focus.id} leaked a non-frontier node`)
  }
})

test('every focus stop has no overlapping source-of-truth tile boxes', () => {
  const width = 250, height = 50
  for (const focus of tree) {
    const positions = layout(tree, singleLayerFrontier(tree, focus.id))
    const ids = Object.keys(positions)
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]], b = positions[ids[j]]
      const separated = Math.abs(a.x - b.x) >= width || Math.abs(a.y - b.y) >= height
      assert.equal(separated, true, `focus ${focus.id} overlaps ${ids[i]} and ${ids[j]}`)
    }
  }
  assert.ok(X_GAP >= width && Y_GAP >= height)
})
