import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PUBLIC_PAGES } from './route.js'

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
const specContent = text('specContent.js')
const launch = text('launch.js')
const fileTree = text('FileTree.jsx')
const project = text('project.js')
const tabs = text('tabs.js')
const workspace = text('workspace.jsx')
const specTreeState = text('specTreeState.js')

test('a published tree runs the workspace shell over static input, opening only the doors it has data for', () => {
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

  // ONE shell for both builds. A published tree is the same workspace — rail, explorer, tab strip, document —
  // reading a static payload, not a separate sealed surface that has to be kept in step by hand.
  assert.doesNotMatch(dashboard, /<ViewHost page="graph"/)
  assert.doesNotMatch(dashboard, /<SideBar page="graph" graphOnly \/>/)
  assert.match(dashboard, /<SideBar page=\{page\} graphOnly=\{graphOnly\}/)

  // The rail is the LIVE rail — same entries, same order, no published-only marker. Graph is addressable
  // but not a rail destination, there as here.
  assert.match(sideBar, /const entries = ENTRIES/)
  assert.doesNotMatch(sideBar, /graphOnly \? \['graph'/)

  // Spec is the landing face, and the rail opens exactly the pages the static payload can answer.
  assert.deepEqual(PUBLIC_PAGES, ['spec', 'file', 'graph'])
  assert.match(route, /PUBLIC_GRAPH_ONLY/)
  assert.match(route, /if \(PUBLIC_PAGES\.includes\(face\.page\)\) return face/)
  assert.match(route, /replaceState\(null, '', '#\/spec'\)/)
  assert.match(sideBar, /disabled=\{graphOnly && !PUBLIC_PAGES\.includes\(p\)\}/)
  assert.match(sideBar, /aria-disabled="true"/)

  // WHICH SOURCE A READER READS IS A PROPERTY OF THE BUILD, not of each call site. Every default below is
  // the same statement made once: a call site that has to remember to pass the flag is a call site that
  // will eventually forget, and forgetting means a static page firing a request only a backend can answer.
  assert.match(specContent, /publicGraph = PUBLIC_GRAPH_ONLY/)
  assert.match(nodeView, /graphOnly = PUBLIC_GRAPH_ONLY/)
  assert.match(nodeView, /panesFor\(node, graphOnly\)/)

  // The live-only reads are answered, not fired: no backend exists behind a published tree.
  assert.match(data, /if \(PUBLIC_GRAPH_ONLY\) return \[\]/)
  assert.match(launch, /if \(PUBLIC_GRAPH_ONLY\) return Promise\.resolve\(\{ launchers: \[\] \}\)/)
  assert.match(fileTree, /!PUBLIC_GRAPH_ONLY && \(/)

  assert.match(dashboard, /onNodeContextMenu=\{graphOnly \? undefined/)
  assert.match(publicMode, /PUBLIC_GRAPH_METADATA_SOURCE/)
  assert.match(dashboard, /graphOnly && <PublicGraphAbout \/>/)
  assert.match(about, /loadPublicGraphMetadata\(\)/)
  assert.doesNotMatch(about, /apiUrl|\/api\//)
})

test('remembered workspace state belongs to the tree the page was served from, not to the origin', () => {
  // One host serves many trees — the gateway's /p/<id> projects, a gallery's published trees under one
  // domain — and localStorage is per-origin. An unsuffixed key hands a reader the tabs and open branches of
  // whichever tree they looked at last, which is how a vConsole page came to show a `requests` tab.
  assert.match(project, /export const scopedStorageKey = \(key\) => \(STORAGE_SCOPE === '\/' \? key : `\$\{key\}@\$\{STORAGE_SCOPE\}`\)/)
  assert.match(project, /replace\(\/\[\^\/\]\*\$\/, ''\)/)
  for (const [name, source] of [['tabs.js', tabs], ['workspace.jsx', workspace], ['specTreeState.js', specTreeState]]) {
    assert.doesNotMatch(source, /localStorage\.(get|set)Item\('/, `${name} keys storage through scopedStorageKey, never a bare literal`)
  }
  assert.match(tabs, /const KEY = scopedStorageKey\('spexcode\.tabs'\)/)
  assert.match(workspace, /scopedStorageKey\('spexcode\.dock'\)/)
  assert.match(specTreeState, /ledger\(scopedStorageKey\('spex\.specTreeOpen'\)\)/)
})
