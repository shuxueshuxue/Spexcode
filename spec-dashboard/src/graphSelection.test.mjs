import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const graph = fs.readFileSync(new URL('./GraphView.jsx', import.meta.url), 'utf8')
const data = fs.readFileSync(new URL('./data.js', import.meta.url), 'utf8')
const spec = fs.readFileSync(new URL('../../.spec/spexcode/spec-dashboard/dashboard-ui/graph/node-graph/spec.md', import.meta.url), 'utf8')

test('graph has no transient marquee selection toolbar or dispatch state', () => {
  assert.doesNotMatch(graph, /graph-selection-actions|graph-selection-send|graph-selection-clear/)
  assert.doesNotMatch(graph, /selectedNodeIds|selectedNodes|setSelectedNodeIds|onSelectionChange|selectionOnDrag|selectionMode/)
  assert.doesNotMatch(graph, /Send to Session/)
  assert.doesNotMatch(spec, /real \*\*marquee selection\*\*/)
})

test('focus camera keeps zoom and centers the node row while anchoring the connection midpoint', () => {
  assert.match(data, /const anchorZoom = fit && !currentFits && fitZoom >= minZoom \? fitZoom : zoom/)
  assert.match(data, /const desiredY = height \/ 2 - focus\.y \* anchorZoom/)
  assert.match(data, /const anchorX = pair \? \(focus\.x \+ pair\.x\) \/ 2 : focus\.x/)
  assert.match(graph, /centerRef\.current\(focusRef\.current, undefined, 300, false\)/)
})
