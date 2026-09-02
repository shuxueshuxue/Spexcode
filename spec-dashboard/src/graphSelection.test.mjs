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

test('primary-pointer drag pans the camera without making nodes draggable', () => {
  assert.match(graph, /panOnDrag=\{true\}/)
  assert.match(graph, /nodesDraggable=\{false\}/)
})

test('focus camera keeps zoom, roots use reading pairs, and non-root tiles use pane centre', () => {
  assert.match(data, /const anchorZoom = fit && !currentFits && fitZoom >= minZoom \? fitZoom : zoom/)
  assert.match(data, /const desiredY = height \/ 2 - focus\.y \* anchorZoom/)
  assert.match(data, /const focusAnchorRatio = parent \? 0\.5 : anchorRatio/)
  assert.match(graph, /centerRef\.current\(focusRef\.current, undefined, 300, false\)/)
})

test('empty graph uses the explicit setup state before mounting the canvas', () => {
  assert.match(graph, /function GraphView\(props\) \{[\s\S]*?if \(specs\.length === 0\) return <GraphEmptyState graphOnly=\{graphOnly\} \/>/)
  assert.match(graph, /graphEmpty\.newSession/)
  assert.match(graph, /graphEmpty\.explorer/)
})
