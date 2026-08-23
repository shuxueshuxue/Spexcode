import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAIL_PAGES, parseRoute } from './route.js'
import { placeTab, tabKey, tabRoute } from './tabModel.js'

const srcDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = dirname(srcDir)

// These paths are deliberate: a retired surface must fail loudly if a future change restores its entry point.
const retiredPaths = [
  join(srcDir, 'SessionSelectBar.jsx'),
  join(dashboardDir, 'test', 'session-multi-select.e2e.mjs'),
  ...['spec.md', 'eval.md', 'evals.ndjson'].map((file) => join(
    dashboardDir, '..', '.spec', 'spexcode', 'spec-dashboard', 'dashboard-ui', 'session-console', 'session-multi-select', file,
  )),
]

const governedSessionFiles = [
  'SessionInterface.jsx',
  'SessionContextMenu.jsx',
  'SessionWindow.jsx',
  'Dock.jsx',
]

test('withdrawn session multi-select mechanism and its retired governance stay absent', () => {
  for (const path of retiredPaths) {
    assert.equal(existsSync(path), false, `retired multi-select artifact returned: ${path}`)
  }

  const forbidden = /SessionSelectBar|onBulkClosed|startSelect|const \[selecting|const \[picked|bulk-close/
  for (const name of governedSessionFiles) {
    const source = readFileSync(join(srcDir, name), 'utf8')
    assert.doesNotMatch(source, forbidden, `${name} revived the withdrawn multi-select mechanism`)
  }

  for (const locale of ['en.js', 'zh.js']) {
    const source = readFileSync(join(srcDir, 'i18n', locale), 'utf8')
    assert.doesNotMatch(source, /\bsessionSelect\s*:/, `${locale} revived dead multi-select copy`)
  }
})

test('live rail does not regrow the retired graph destination', () => {
  assert.deepEqual(RAIL_PAGES, ['sessions', 'evals', 'issues', 'settings'])
  assert.equal(RAIL_PAGES.includes('graph'), false)
})

test('empty workspace remains a real route and view entry', () => {
  assert.deepEqual(parseRoute('#/empty'), { page: 'empty', param: null, query: {} })
  const emptyView = join(srcDir, 'EmptyView.jsx')
  assert.equal(existsSync(emptyView), true, 'EmptyView was deleted')
  assert.ok(readFileSync(emptyView, 'utf8').trim().length > 0, 'EmptyView became empty')
  const views = readFileSync(join(srcDir, 'views.jsx'), 'utf8')
  assert.match(views, /\bempty:\s*\{[^\n]*component:\s*EmptyView\b/)
})

test('resident details focus one top-level tab without evicting documents', () => {
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
    { page: 'evals', param: 'node/scenario', pinned: true },
    { page: 'issues', param: '42', pinned: true },
  ])
  assert.deepEqual(tabRoute(evalDetail), { page: 'evals', param: null, query: null })
  assert.deepEqual(tabRoute(issueDetail), { page: 'issues', param: null, query: null })
})
