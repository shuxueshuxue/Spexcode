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
  const selectBar = readFileSync(join(srcDir, 'SessionSelectBar.jsx'), 'utf8')
  const context = readFileSync(join(srcDir, 'SessionContextMenu.jsx'), 'utf8')
  assert.match(panel, /SessionSelectBar/)
  assert.match(panel, /startDrag/)
  assert.match(panel, /data-session-root-drop/)
  assert.match(panel, /sessionAncestorIds/)
  assert.match(context, /startSelect/)
  assert.match(context, /onDetach/)
  assert.match(selectBar, /<IconButton icon="trash"[^>]*className="si-selaction danger"[^>]*label=\{t\('sessionSelect\.close'\)\}/s)
  assert.match(selectBar, /<IconButton icon="x"[^>]*className="si-selaction"[^>]*label=\{t\('common\.cancel'\)\}/s)
  assert.match(css, /\.si-selbar\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*gap:\s*var\(--space-1\);[^}]*min-width:\s*0;/s)
  assert.match(css, /\.si-selcount\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s)
  assert.match(css, /\.si-selaction\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/s)
  for (const locale of ['en.js', 'zh.js']) {
    const source = readFileSync(join(srcDir, 'i18n', locale), 'utf8')
    assert.match(source, /sessionSelect\s*:/)
  }
})

test('Sessions archive pill opens the existing routed archive overlay', () => {
  const panel = readFileSync(join(srcDir, 'SessionForestPanel.jsx'), 'utf8')
  const sessionsView = readFileSync(join(srcDir, 'SessionsView.jsx'), 'utf8')
  const sessionInterface = readFileSync(join(srcDir, 'SessionInterface.jsx'), 'utf8')
  assert.match(panel, /className=\{`si-pill archive\$\{archiveActive \? ' on' : ''\}`\}/)
  assert.match(panel, /aria-label=\{t\('session\.archiveTitle'\)\}/)
  assert.match(sessionsView, /onOpenArchive=\{\(\) => scope\.open\(\{[\s\S]{0,160}query: \{ archive: '1' \}/)
  assert.match(sessionInterface, /archiveActive=\{archiveRequested\}/)
  assert.match(sessionInterface, /onArchive=\{onOpenArchive\}/)
})

test('live rail exposes every resident board, including Spec, but not retired graph destination', () => {
  assert.deepEqual(RAIL_PAGES, ['spec', 'sessions', 'evals', 'issues', 'settings'])
  assert.equal(RAIL_PAGES.includes('graph'), false)
})

test('sessions document owns the only forest and rail labels resolve through i18n', () => {
  const dock = readFileSync(join(srcDir, 'Dock.jsx'), 'utf8')
  const shell = readFileSync(join(srcDir, 'Shell.jsx'), 'utf8')
  const sideBar = readFileSync(join(srcDir, 'SideBar.jsx'), 'utf8')
  const en = readFileSync(join(srcDir, 'i18n', 'en.js'), 'utf8')
  const zh = readFileSync(join(srcDir, 'i18n', 'zh.js'), 'utf8')
  assert.match(dock, /if \(suppressRows\) return null/)
  assert.doesNotMatch(dock, /data-session-list-projection="document"/)
  assert.match(shell, /if \(page === 'sessions'\) return 'none'/)
  assert.match(sideBar, /const ENTRIES = RAIL_PAGES/)
  assert.match(en, /nav:\s*\{[\s\S]*?spec:\s*'Spec'/)
  assert.match(zh, /nav:\s*\{[\s\S]*?spec:\s*'规格'/)
})

test('the rail panel control folds the Sessions forest and is absent only where no sidebar exists', () => {
  const shell = readFileSync(join(srcDir, 'Shell.jsx'), 'utf8')
  const sessionInterface = readFileSync(join(srcDir, 'SessionInterface.jsx'), 'utf8')
  // Sessions mounts no shell dock, yet its document draws its own forest sidebar — so the control stays
  // mounted there and folds that forest through the one workspace open/closed boolean. Bare review and
  // settings boards have neither sidebar, and only they lose the control.
  assert.match(shell, /const foldable = dockKind !== 'none' \|\| page === 'sessions'/)
  assert.match(shell, /hideDockToggle=\{!foldable\}/)
  assert.doesNotMatch(shell, /hideDockToggle=\{page === 'sessions'\}/)
  assert.match(sessionInterface, /const \{ dock: forestOpen \} = useWorkspace\(\)/)
  assert.match(sessionInterface, /\{forestOpen && <SessionForestPanel/)
})

test('Explorer keeps one fixed Spec graph entry below its Specs/Files disclosures', () => {
  const fileTree = readFileSync(join(srcDir, 'FileTree.jsx'), 'utf8')
  const en = readFileSync(join(srcDir, 'i18n', 'en.js'), 'utf8')
  const zh = readFileSync(join(srcDir, 'i18n', 'zh.js'), 'utf8')
  assert.match(fileTree, /className="ft-graph-entry"/)
  assert.match(fileTree, /navigate\('spec'\)/)
  assert.match(en, /fileTree:\s*\{[\s\S]*graph:\s*'Spec graph'/)
  assert.match(zh, /fileTree:\s*\{[\s\S]*graph:\s*'规格图谱'/)
})

test('session row clicks focus an existing workspace tab before replacing the current slot', () => {
  const dock = readFileSync(join(srcDir, 'Dock.jsx'), 'utf8')
  const sessionsView = readFileSync(join(srcDir, 'SessionsView.jsx'), 'utf8')
  const sessionInterface = readFileSync(join(srcDir, 'SessionInterface.jsx'), 'utf8')
  assert.match(dock, /focusSessionTab\(item\.s\.id,/)
  assert.match(sessionsView, /focusSessionTab\(id,/)
  assert.match(sessionsView, /scope\.open\(\{ page: 'sessions', param: id, query: null \}\)/)
  assert.match(sessionInterface, /onSelect=\{\(id, options\) => onPickSession \? onPickSession\(id, options\)/)
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
