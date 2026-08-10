import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const app = text('App.jsx')
const root = text('Root.jsx')
const data = text('data.js')
const dashboard = text('Dashboard.jsx')
const sideBar = text('SideBar.jsx')
const nodeView = text('NodeView.jsx')

test('public graph mode has one static input and closes every live dashboard door', () => {
  assert.match(data, /fetch\(PUBLIC_GRAPH_SOURCE, \{ cache: 'no-store' \}\)/)
  assert.match(data, /fetch\(source, \{ cache: 'no-store' \}\)/)
  assert.match(data, /spexcode\.public-spec-document\/v1/)
  assert.match(data, /schema !== 'spexcode\.public-spec-graph\/v1'/)
  assert.match(app, /if \(PUBLIC_GRAPH_ONLY\) return undefined\s*\n\s*let live = true/)
  assert.match(app, /if \(PUBLIC_GRAPH_ONLY\) \{\s*reload\(\)\s*return undefined/s)
  assert.match(app, /graphOnly \/>/)
  assert.match(root, /if \(PUBLIC_GRAPH_ONLY\) \{/)
  assert.match(root, /<App \/>/)
  assert.match(sideBar, /disabled=\{graphOnly && p !== 'graph'\}/)
  assert.match(sideBar, /aria-disabled="true"/)
  assert.match(dashboard, /if \(graphOnly && page !== 'graph'\) navigate\('graph'/)
  assert.match(dashboard, /onNodeContextMenu=\{graphOnly \? undefined/)
  assert.match(nodeView, /panesFor\(node, graphOnly\)/)
})
