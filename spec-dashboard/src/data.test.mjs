import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, singleLayerFrontier, viewportForFocus, CAMERA_ANCHOR_RATIO, CAMERA_GUTTER, X_GAP, Y_GAP } from './data.js'

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

test('expanding the focused child adds a column without moving the existing columns', () => {
  const before = layout(tree, new Set(['root', 'a']))
  const after = layout(tree, new Set(['root', 'a', 'a1']))
  for (const id of Object.keys(before)) assert.deepEqual(after[id], before[id])
  assert.deepEqual(after.a1, { x: 2 * X_GAP, y: before.a.y - Y_GAP / 2 })
  assert.deepEqual(after.a2, { x: 2 * X_GAP, y: before.a.y + Y_GAP / 2 })
})

test('switching the focused sibling leaves the parent column unchanged', () => {
  const before = layout(tree, new Set(['root', 'a']))
  const after = layout(tree, new Set(['root', 'b']))
  for (const id of ['root', 'a', 'b']) assert.deepEqual(after[id], before[id])
  assert.equal(after.b1.x, 2 * X_GAP)
})

test('each column is evenly spaced around its spine parent', () => {
  const pos = layout(tree, new Set(['root', 'a', 'a1']))
  assert.equal(pos.a2.y - pos.a1.y, Y_GAP)
  assert.equal(pos.a1.y + pos.a2.y, 2 * pos.a.y)
  assert.equal(pos.a1x.x, 3 * X_GAP)
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

test('camera anchors a focus-child reading pair to the left-of-centre token', () => {
  const focus = { x: 0, y: 0 }
  const child = { x: X_GAP, y: 0 }
  const viewport = viewportForFocus({ focus, child, visible: [focus, child], width: 900, height: 600, zoom: 0.85, fit: false })
  assert.equal(viewport.zoom, 0.85)
  assert.equal(viewport.x, 900 * CAMERA_ANCHOR_RATIO - (X_GAP / 2) * viewport.zoom)
  assert.equal(viewport.y, 300)
})

test('camera uses the parent-focus midpoint for a leaf', () => {
  const focus = { x: X_GAP, y: 54 }
  const parent = { x: 0, y: 0 }
  const viewport = viewportForFocus({ focus, parent, visible: [parent, focus], width: 900, height: 600, zoom: 1, fit: false })
  assert.equal(viewport.x, 900 * CAMERA_ANCHOR_RATIO - (X_GAP / 2))
  assert.equal(viewport.y, 300 - focus.y)
})

test('camera fits a complete small neighbourhood and leaves one grid gutter', () => {
  const root = { x: 0, y: 0 }
  const child = { x: X_GAP, y: 0 }
  const viewport = viewportForFocus({ focus: root, child, visible: [root, child], width: 900, height: 600, zoom: 0.85 })
  assert.equal(viewport.zoom, (900 - CAMERA_GUTTER) / (X_GAP + 176))
  assert.equal(viewport.x, CAMERA_GUTTER + 88 * viewport.zoom)
  assert.equal(viewport.y, 300)
})

test('camera falls back to the reading anchor when the visible bbox cannot fit', () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({ x: index * X_GAP, y: 0 }))
  const focus = nodes[0]
  const viewport = viewportForFocus({ focus, child: nodes[1], visible: nodes, width: 900, height: 600, zoom: 0.85 })
  assert.equal(viewport.zoom, 0.85)
  assert.equal(viewport.x, 900 * CAMERA_ANCHOR_RATIO - (X_GAP / 2) * viewport.zoom)
})

test('camera keeps the reading anchor when fitting would require zooming out', () => {
  const nodes = Array.from({ length: 5 }, (_, index) => ({ x: index * X_GAP, y: 0 }))
  const viewport = viewportForFocus({ focus: nodes[4], parent: nodes[3], visible: nodes, width: 900, height: 600, zoom: 0.85 })
  assert.equal(viewport.zoom, 0.85)
  assert.equal(viewport.x, 900 * CAMERA_ANCHOR_RATIO - (nodes[3].x + nodes[4].x) / 2 * viewport.zoom)
})
