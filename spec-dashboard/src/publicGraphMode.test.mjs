import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const text = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
const app = text('App.jsx')
const root = text('Root.jsx')
const data = text('data.js')
const dashboard = text('Shell.jsx') + text('GraphView.jsx') + text('views.jsx')
const sideBar = text('SideBar.jsx')
const nodeView = text('NodeView.jsx')
const publicMode = text('public-mode.js')
const about = text('PublicGraphAbout.jsx')
const route = text('route.js')

test('public graph mode has one static input and closes every live dashboard door', () => {
  assert.match(data, /fetch\(PUBLIC_GRAPH_SOURCE, \{ cache: 'no-cache' \}\)/)
  assert.match(data, /fetch\(source, \{ cache: 'no-cache' \}\)/)
  assert.match(data, /fetch\(PUBLIC_GRAPH_METADATA_SOURCE, \{ cache: 'no-cache' \}\)/)
  assert.match(data, /spexcode\.public-spec-document\/v1/)
  assert.match(data, /schema !== 'spexcode\.public-spec-graph\/v1'/)
  assert.match(app, /if \(PUBLIC_GRAPH_ONLY\) return undefined\s*\n\s*let live = true/)
  assert.match(app, /if \(!PUBLIC_GRAPH_ONLY\) return undefined\s*\n\s*reload\(\)/s)
  assert.match(app, /graphOnly: true/)
  assert.match(root, /if \(PUBLIC_GRAPH_ONLY\) \{/)
  assert.match(root, /<App \/>/)
  assert.match(sideBar, /disabled=\{graphOnly && p !== 'graph'\}/)
  assert.match(sideBar, /aria-disabled="true"/)
  // the sealed face no longer REDIRECTS away from a live address — the shell never renders one for it.
  // A door that is not built is shut more firmly than a door that closes itself.
  assert.match(dashboard, /if \(graphOnly\) \{/)
  assert.match(dashboard, /<ViewHost page="graph"/)
  assert.match(dashboard, /<StatusBar \/>/)
  assert.match(dashboard, /onNodeContextMenu=\{graphOnly \? undefined/)
  assert.match(nodeView, /panesFor\(node, graphOnly\)/)
  assert.match(publicMode, /PUBLIC_GRAPH_METADATA_SOURCE/)
  assert.match(dashboard, /graphOnly && <PublicGraphAbout \/>/)
  assert.match(about, /loadPublicGraphMetadata\(\)/)
  assert.doesNotMatch(about, /apiUrl|\/api\//)
  assert.match(route, /PUBLIC_GRAPH_ONLY/)
  assert.match(route, /PUBLIC_GRAPH_ONLY && window\.location\.hash !== '#\/graph'/)
  assert.match(dashboard, /<SideBar page="graph" graphOnly \/>/)
})
