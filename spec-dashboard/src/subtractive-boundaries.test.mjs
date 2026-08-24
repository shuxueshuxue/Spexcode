import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAIL_PAGES, parseRoute } from './route.js'
import { placeTab, tabKey, tabRoute } from './tabModel.js'

const srcDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = dirname(srcDir)
const css = readFileSync(join(srcDir, 'styles.css'), 'utf8')

const governedSessionFiles = [
  'SessionInterface.jsx',
  'SessionContextMenu.jsx',
  'SessionWindow.jsx',
  'Dock.jsx',
]

test('Sessions keeps multi-select and tree movement on the real row surface', () => {
  const panel = readFileSync(join(srcDir, 'SessionForestPanel.jsx'), 'utf8')
  const context = readFileSync(join(srcDir, 'SessionContextMenu.jsx'), 'utf8')
  assert.match(panel, /SessionSelectBar/)
  assert.match(panel, /startDrag/)
  assert.match(panel, /data-session-root-drop/)
  assert.match(panel, /sessionAncestorIds/)
  assert.match(context, /startSelect/)
  assert.match(context, /onDetach/)
  for (const locale of ['en.js', 'zh.js']) {
    const source = readFileSync(join(srcDir, 'i18n', locale), 'utf8')
    assert.match(source, /sessionSelect\s*:/)
  }
})

test('live rail does not regrow the retired graph destination', () => {
  assert.deepEqual(RAIL_PAGES, ['sessions', 'evals', 'issues', 'settings'])
  assert.equal(RAIL_PAGES.includes('graph'), false)
})

test('retired generic pane-resizer CSS stays absent', () => {
  assert.doesNotMatch(css, /\.pane-resizer\b/, 'dead generic pane-resizer CSS returned')
  assert.match(css, /\.content-divider\b/, 'live split resize seam disappeared with the dead generic rule')
  assert.match(css, /\.ft-resize\b/, 'live file-tree resize seam disappeared with the dead generic rule')
  assert.match(css, /\.ctx-resize\b/, 'live context-dock resize seam disappeared with the dead generic rule')
})

test('empty workspace remains a real route and view entry', () => {
  assert.deepEqual(parseRoute('#/empty'), { page: 'empty', param: null, query: {} })
  const emptyView = join(srcDir, 'EmptyView.jsx')
  assert.equal(existsSync(emptyView), true, 'EmptyView was deleted')
  assert.ok(readFileSync(emptyView, 'utf8').trim().length > 0, 'EmptyView became empty')
  const views = readFileSync(join(srcDir, 'views.jsx'), 'utf8')
  assert.match(views, /\bempty:\s*\{[^\n]*component:\s*EmptyView\b/)
})

test('board details focus one dynamic top-level tab without evicting documents', () => {
  const spec = { page: 'spec', param: 'node', query: null }
  const session = { page: 'sessions', param: 's1', query: null }
  let tabs = placeTab(placeTab([], spec, 'pin'), session, 'pin')
  const evalDetail = { page: 'evals', param: 'node/scenario', query: null }
  const issueDetail = { page: 'issues', param: '42', query: null }
  tabs = placeTab(placeTab(tabs, evalDetail), issueDetail)

  assert.equal(tabKey(evalDetail), '#/evals')
  assert.equal(tabKey(issueDetail), '#/issues')
  assert.deepEqual(tabs.map(tabKey), ['#/spec', '#/sessions/s1', '#/evals', '#/issues'])
  assert.deepEqual(tabs.slice(2).map(({ page, param, pinned }) => ({ page, param, pinned })), [
    { page: 'evals', param: 'node/scenario', pinned: false },
    { page: 'issues', param: '42', pinned: false },
  ])
  assert.deepEqual(tabRoute(evalDetail), { page: 'evals', param: null, query: null })
  assert.deepEqual(tabRoute(issueDetail), { page: 'issues', param: null, query: null })
})
