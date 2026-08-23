import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const graph = fs.readFileSync(new URL('./GraphView.jsx', import.meta.url), 'utf8')
const spec = fs.readFileSync(new URL('../../.spec/spexcode/spec-dashboard/dashboard-ui/graph/node-graph/spec.md', import.meta.url), 'utf8')

test('graph marquee selection is a real React Flow selection and dispatches through the ordinary composer', () => {
  assert.match(graph, /selectionOnDrag\s*\n\s*selectionMode="partial"/)
  assert.match(graph, /onSelectionChange=\{\(selection\) => setSelectedNodeIds\(selection\.nodes\.map\(\(node\) => node\.id\)\)\}/)
  assert.match(graph, /selectedNodes\.map\(\(node\) => `\[\[\$\{node\.id\}\]\]`\)/)
  assert.match(graph, /className="graph-selection-actions"/)
  assert.match(graph, /startNew\(`\$\{selectedNodes\.map/)
  assert.match(graph, /setSelectedNodeIds\(\[\]\)/)
  assert.match(graph, /!graphOnly && selectedNodes\.length > 0/)
  assert.match(spec, /real \*\*marquee selection\*\*/) 
})
