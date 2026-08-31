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
  assert.match(shell, /if \(page === 'issues' \|\| page === 'evals'\) return 'none'/)
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
  // it is still ONE boolean; the forest just folds on it through the shared fold, so the mount outlives
  // the flag by one panel duration instead of blinking out ([[dock-modes]]).
  assert.match(sessionInterface, /const \[forestMounted, forestClosing, forestFolding\] = useFold\(forestOpen\)/)
  assert.match(sessionInterface, /\{forestMounted && <SessionForestPanel/)
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

test('session row clicks are plain navigation; the strip alone decides focus-or-replace', () => {
  const dock = readFileSync(join(srcDir, 'Dock.jsx'), 'utf8')
  const sessionsView = readFileSync(join(srcDir, 'SessionsView.jsx'), 'utf8')
  const sessionInterface = readFileSync(join(srcDir, 'SessionInterface.jsx'), 'utf8')
  assert.match(dock, /else navigate\('sessions', item\.s\.id\)/)
  assert.match(sessionsView, /const route = \{ page: 'sessions', param: id, query: null \}/)
  assert.match(sessionsView, /return scope\.open\(route\)/)
  assert.match(sessionInterface, /onSelect=\{\(id, options\) => onPickSession \? onPickSession\(id, options\)/)
})

test('Sessions selection is the routed address, never a mirrored local state', () => {
  const sessionsView = readFileSync(join(srcDir, 'SessionsView.jsx'), 'utf8')
  assert.match(sessionsView, /const selection = param && param !== 'new' \? param : 'new'/)
  assert.match(sessionsView, /sel=\{selection\}/)
  assert.match(sessionsView, /setSel=\{pickSession\}/)
  assert.doesNotMatch(sessionsView, /\[sel, setSel\]/)
  assert.doesNotMatch(sessionsView, /setSel\(param/)
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
  let tabs = placeTab(placeTab([], spec, 'append'), session, 'append')
  const evalDetail = { page: 'evals', param: 'node/scenario', query: null }
  const issueDetail = { page: 'issues', param: '42', query: null }
  tabs = placeTab(placeTab(tabs, evalDetail), issueDetail)

  assert.equal(tabKey(evalDetail), '#/evals')
  assert.equal(tabKey(issueDetail), '#/issues')
  assert.deepEqual(tabs.map(tabKey), ['#/spec', '#/sessions/s1', '#/evals', '#/issues'])
  assert.deepEqual(tabs.slice(2), [
    { page: 'evals', param: 'node/scenario', query: null },
    { page: 'issues', param: '42', query: null },
  ])
  assert.deepEqual(tabRoute(evalDetail), { page: 'evals', param: null, query: null })
  assert.deepEqual(tabRoute(issueDetail), { page: 'issues', param: null, query: null })
})

// THE TREE IS A VIEW OF THE ADDRESS. Each row used to own its `open` flag in local state, which broke two
// things at once: a row unmounts when an ancestor collapses or the dock folds, so `useState` discarded the
// reader's arrangement; and nothing outside a row could reach that state, so routing to a spec left the
// explorer sitting on a closed root while that spec's document was open beside it.
test('the spec tree remembers its disclosure and opens the branch the address names', () => {
  const tree = readFileSync(join(srcDir, 'FileTree.jsx'), 'utf8')
  const store = readFileSync(join(srcDir, 'specTreeState.js'), 'utf8')
  // no row-local disclosure state survives
  assert.doesNotMatch(tree, /const \[open, setOpen\] = useState\(false\)/)
  assert.match(tree, /const \{ open: openIds \} = useSpecTreeState\(\)/)
  assert.match(tree, /toggleSpecNode\(node\.id\)/)
  // the reveal walks ANCESTORS only — disclosure means "show me what is inside", and forcing the focused
  // node open would answer a question the reader never asked and fight their own collapse of it
  assert.match(tree, /revealSpecPath\(path\)/)
  assert.match(tree, /for \(let id = parentOf\.get\(focusId\)/)
  // the arrangement outlives the session, and a blocked storage read still yields a correct empty tree
  assert.match(store, /localStorage\.setItem\(KEY/)
  assert.match(store, /catch \{ return new Set\(\) \}/)
  // a route onto an already-visible node must cost no render
  assert.match(store, /if \(!wanted\.length \|\| wanted\.every\(\(id\) => snapshot\.open\.has\(id\)\)\) return/)
})

// A FOLD is a width movement; a HANDOVER is the same band changing what it shows. The left band is drawn by
// the shell dock on document routes and by the Sessions document's forest on Sessions, so a route switch
// swaps which COMPONENT draws it — and running the fold there collapsed the band to nothing and grew it
// back, which is what "the sidebar is torn down and rebuilt" looked like. Measured before the fix: the band
// went 1px -> 204px across the swap; after, it holds 204px and only the contents dissolve.
test('the left band folds on a fold and dissolves on a route handover', () => {
  const css = readFileSync(join(srcDir, 'styles.css'), 'utf8')
  const fold = readFileSync(join(srcDir, 'useFold.js'), 'utf8')
  const dock = readFileSync(join(srcDir, 'Dock.jsx'), 'utf8')
  // the width animation is gated on the arrival being a real fold
  assert.match(css, /\.dock\[data-fold='in'\][^{]*\{[^}]*animation: dock-in/)
  assert.match(css, /\.dock\[data-fold='swap'\][^{]*\{[^}]*animation: dock-swap/)
  assert.match(css, /@keyframes dock-swap \{ from \{ opacity: 0; transform: translateX\(-6px\); \} \}/)
  assert.doesNotMatch(css, /^\.dock, \.si-list, \.context-dock \{ animation: dock-in/m)
  assert.match(fold, /return \[open \|\| closing, closing, folding\]/)
  assert.match(dock, /data-fold=\{arrival \|\| undefined\}/)
})

// THE FOLD MOVES FOR ITS WHOLE DURATION, AND ONLY ONE ANIMATION RUNS PER GESTURE. Two defects made one
// twitch. The keyframes animated max-width, whose other endpoint is the 640px CAP rather than the band's own
// 204px, so a 170ms open finished moving at 50ms and stalled at half opacity while a close held still for
// 60ms and then dropped. And the handover was CSS's unconditional fallback, which is the state a panel
// LEAVING a fold passes through — so the fold ended by blinking to opacity 0, jumping 6px left, and
// dissolving back in. Measured before: three movements over 350ms to open. After: one, over 170ms.
test('the fold animates the band own width, and rest is a state of its own', () => {
  const css = readFileSync(join(srcDir, 'styles.css'), 'utf8')
  const fold = readFileSync(join(srcDir, 'useFold.js'), 'utf8')
  // a `from`-only keyframe: the other endpoint is the element's own width, whatever the reader dragged it to
  assert.match(css, /@keyframes dock-in \{ from \{ width: 0; opacity: 0; \} \}/)
  assert.match(css, /@keyframes dock-out \{ to \{ width: 0; opacity: 0; \} \}/)
  assert.doesNotMatch(css, /@keyframes dock-(in|out) \{[^}]*max-width/)
  // no rule may animate a panel that named no arrival — that fallback is what a finished fold falls into
  assert.doesNotMatch(css, /^\.dock, \.si-list \{ animation:/m)
  // three-valued, and rest is one of the three
  assert.match(fold, /if \(folding\) return 'in'\n\s*return swap \? 'swap' : null/)
  // read during the render that changes `open`, never from an effect — an effect runs after paint, so the
  // first committed frame would carry the wrong animation and be replaced by the right one.
  assert.match(fold, /if \(was !== open\) \{\n\s*setWas\(open\)/)
})

// A FOLD IS A STATE CHANGE; A HANDOVER IS A MOUNT, and they are read in different places because they happen
// in different places. The shell stays mounted across the route switch that replaces its dock with the
// Sessions forest, so the shell's own fold flag sees no transition at all — reading the handover from it left
// one direction of the swap with no dissolve while the other had one. Every band panel reads its own mount.
test('every foldable panel reads its handover from its own mount', () => {
  const fold = readFileSync(join(srcDir, 'useFold.js'), 'utf8')
  assert.match(fold, /export function useArrival\(folding, ms = DOCK_FOLD_MS\)/)
  // a panel that mounted mid-fold is that fold, and never also claims the swap
  assert.match(fold, /useState\(!folding\)/)
  for (const f of ['Dock.jsx', 'SessionForestPanel.jsx', 'ContextDock.jsx']) {
    const source = readFileSync(join(srcDir, f), 'utf8')
    assert.match(source, /useArrival\(folding\)/, f)
    assert.match(source, /data-fold=\{arrival \|\| undefined\}/, f)
  }
})

// ONE BAND, ONE WIDTH. The shell dock persisted spex.ftWidth and the Sessions forest persisted
// spex.siListWidth for the same region, so whichever the reader last dragged silently disagreed with the
// other — and the mismatch moved the document column at every route switch.
test('the left band has a single persisted width', () => {
  const band = readFileSync(join(srcDir, 'dockBand.js'), 'utf8')
  for (const f of ['Dock.jsx', 'FileTree.jsx', 'SessionForestPanel.jsx']) {
    const source = readFileSync(join(srcDir, f), 'utf8')
    assert.match(source, /useResizable\(DOCK_BAND\.key, DOCK_BAND\.initial, DOCK_BAND\)/, f)
    assert.doesNotMatch(source, /spex\.ftWidth|spex\.siListWidth/, f)
  }
  // a one-time migration, never a permanent read fallback: the legacy keys are adopted once and removed
  assert.match(band, /LEGACY\.forEach\(\(key\) => localStorage\.removeItem\(key\)\)/)
})
