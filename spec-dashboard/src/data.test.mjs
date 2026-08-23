import test from 'node:test'
import assert from 'node:assert/strict'
import { graphTitles, layout } from './data.js'

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

test('duplicate titles get the shortest ancestor qualifier only when needed', () => {
  const nodes = [
    { id: 'alpha', parent: null, title: 'Alpha' },
    { id: 'one', parent: 'alpha', title: 'Leaf' },
    { id: 'beta', parent: null, title: 'Beta' },
    { id: 'two', parent: 'beta', title: 'Leaf' },
    { id: 'solo', parent: null, title: 'Solo' },
  ]
  const titles = graphTitles(nodes)
  assert.equal(titles.get('one'), 'Alpha/Leaf')
  assert.equal(titles.get('two'), 'Beta/Leaf')
  assert.equal(titles.get('solo'), 'Solo')
})
