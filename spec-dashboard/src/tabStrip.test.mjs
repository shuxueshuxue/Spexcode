import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./TabStrip.jsx', import.meta.url), 'utf8')
const gesture = readFileSync(new URL('./dragGesture.js', import.meta.url), 'utf8')
const sideBar = readFileSync(new URL('./SideBar.jsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./Shell.jsx', import.meta.url), 'utf8')
const views = readFileSync(new URL('./views.jsx', import.meta.url), 'utf8')
const catalog = readFileSync(new URL('./viewCatalog.js', import.meta.url), 'utf8')
const builtInViewPlugins = readFileSync(new URL('./builtInViewPlugins.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const tabs = readFileSync(new URL('./tabs.js', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./workspace.jsx', import.meta.url), 'utf8')
const dock = readFileSync(new URL('./Dock.jsx', import.meta.url), 'utf8')
const dockToggleSource = readFileSync(new URL('./DockToggle.jsx', import.meta.url), 'utf8')
const fileTree = readFileSync(new URL('./FileTree.jsx', import.meta.url), 'utf8')
const forest = readFileSync(new URL('./SessionForestPanel.jsx', import.meta.url), 'utf8')
const sessionsView = readFileSync(new URL('./SessionsView.jsx', import.meta.url), 'utf8')
const sessionMenu = readFileSync(new URL('./SessionContextMenu.jsx', import.meta.url), 'utf8')
const palette = readFileSync(new URL('./SpecSearch.jsx', import.meta.url), 'utf8')
const keymap = readFileSync(new URL('./keymap.js', import.meta.url), 'utf8')
const en = readFileSync(new URL('./i18n/en.js', import.meta.url), 'utf8')
const zh = readFileSync(new URL('./i18n/zh.js', import.meta.url), 'utf8')

test('tab right-click opens the shared context menu instead of closing silently', () => {
  assert.match(source, /ContextMenuGroup[\s\S]*tabs\.menuClose[\s\S]*tabs\.menuCloseOthers[\s\S]*tabs\.menuSplitRight[\s\S]*tabs\.menuSplitDown/)
  assert.match(source, /onContextMenu=\{\(e\) => \{\s*if \(isClosing\) return\s*e\.preventDefault\(\)\s*setMenu\(\{ x: e\.clientX, y: e\.clientY, tab, key \}\)\s*\}\}/)
  // every tab gets the same tab menu; a session's lifecycle verbs stay on its row, never on the strip
  assert.doesNotMatch(source, /onSessionContextMenu/)
  assert.doesNotMatch(source, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); closeOthers\(tab\)/)
})

test('tab menu actions are explicit and use the existing workspace APIs', () => {
  assert.match(source, /close\(menu\.tab\)/)
  assert.match(source, /closeOthers\(menu\.tab\)/)
  assert.match(source, /setHeldSide\(dir === 'col' \? 'bottom' : 'right'\); split\(menu\.tab, dir\)/)
  // the verb names the SIDE it puts the document on: "horizontal"/"vertical" name opposite things in an
  // editor and in a terminal multiplexer, and the reader should not have to know which one this window meant
  assert.match(source, /\['row', 'panel-right', 'tabs\.menuSplitRight'\], \['col', 'panel-bottom', 'tabs\.menuSplitDown'\]/)
  // the move is refused when it would empty the strip, and the verb says so instead of doing nothing
  assert.match(source, /disabled=\{tabs\.length < 2\}/)
  assert.match(source, /useEscLayer\(!!menu/)
})

test('ordinary navigation names the focused tab so an inactive tab cannot be replaced', () => {
  assert.match(tabs, /let focusedKey = null/)
  assert.match(tabs, /const priorKey = focusedKey\n    focusedKey = key/)
  assert.match(tabs, /tabs: placeTab\(group\.tabs, route, mode, priorKey\), active: key/)
  // an address already open in ANOTHER group focuses that group instead of opening a second copy
  assert.match(tabs, /const holder = groupHolding\(held\.root, key\)/)
})

test('the strip is one clipping row, and the tab list is the way back to what the row cannot show', () => {
  assert.doesNotMatch(source, /wrapped|TAB_WRAP_FLOOR/)
  assert.match(source, /new ResizeObserver\(update\)/)
  assert.match(source, /host\.scrollWidth > host\.clientWidth \+ 1/)
  assert.match(source, /querySelector\('\.tab\.on'\)[\s\S]{0,40}scrollIntoView/)
  assert.match(source, /className=\{`document-action-button tab-list-button\$\{clipped \? ' clipped' : ''\}/)
  assert.match(source, /aria-haspopup="menu" aria-expanded=\{!!listMenu\}/)
  assert.match(source, /\{tabs\.map\(\(tab\) => \{[\s\S]{0,700}setListMenu\(null\); open\(tab\)/)
  assert.match(source, /useEscLayer\(!!menu \|\| !!listMenu/)
})

test('the active card carries two shoulders that curve it into the pane', () => {
  assert.match(source, /\{active && <><i className="tab-shoulder tab-shoulder-l" aria-hidden="true" \/><i className="tab-shoulder tab-shoulder-r" aria-hidden="true" \/><\/>\}/)
})

test('closing tabs retain their original visual slot while the live list updates', () => {
  assert.match(source, /renderedTabs\.splice\(Math\.max\(0, Math\.min\(entry\.index, renderedTabs\.length\)\)/)
})

test('tab dragging reorders during motion and treats the strip tail as an end landing', () => {
  assert.match(source, /const track = \(point\) => \{[\s\S]{0,460}if \(landing && landing\.group === group\) move\(key, landing\.before\)[\s\S]{0,220}setDrag/)
  // a drag that ends over ANOTHER group's strip moves the document there ([[tab-layout]])
  assert.match(source, /if \(landing\) move\(key, landing\.before, landing\.group\)/)
  assert.match(source, /const targetGroup = host\?\.dataset\.group/)
  // the strip a tab is over answers both halves of a landing — which group, and where in it
  assert.match(source, /const host = el\.closest\('\.tabstrip-tabs'\)/)
})

test('tab tear-off captures the pointer so release outside the viewport reaches the gesture', () => {
  assert.match(source, /onPointerDown=\{\(e\) => \{ if \(!isClosing\) startTabDrag\(e, tab\) \}\}/)
  assert.match(gesture, /setPointerCapture\(pointerId\)/)
  assert.match(gesture, /window\.addEventListener\('pointerup', onPointerUp, true\)/)
})

test('tab gesture defers pointer capture until a real drag', () => {
  assert.match(gesture, /if \(pointerMode\) \{[\s\S]*window\.addEventListener\('pointermove', onPointerMove, true\)/)
  assert.match(gesture, /if \(canCapture\) \{[\s\S]*captureTarget\.setPointerCapture\(pointerId\)/)
  assert.match(gesture, /if \(captured && captureTarget\.hasPointerCapture\?\.\(pointerId\)\)/)
})

test('dragging a tab outside the viewport opens its scoped address and closes through the tab store', () => {
  assert.match(source, /outsideViewport = \(\{ x, y \}\) => x < 0 \|\| y < 0 \|\| x > window\.innerWidth \|\| y > window\.innerHeight/)
  assert.match(source, /window\.open\(tabWindowAddress\(detached\)\)/)
  assert.match(source, /window\.open\(tabWindowAddress\(detached\)\)[\s\S]{0,80}close\(detached\)/)
  assert.match(source, /PROJECT_ID \? projectHref\(PROJECT_ID, hash\) : hash/)
})

test('session tabs use the shared visible title, not the stable search handle', () => {
  assert.match(source, /import \{ moveTab, setTabTitle, tabKey, useTabs \} from '\.\/tabs\.js'/)
  assert.match(source, /const title = s \? sessionHeadline\(s\) : \(tab\.title \|\| tab\.param\.slice\(0, 8\)\)/)
  assert.match(source, /setTabTitle\(tab, title\)/)
  assert.doesNotMatch(source, /localStorage/)
  assert.doesNotMatch(source, /archive-index/)
  assert.match(tabs, /export const setTabTitle = \(tabOrKey, title\)/)
})

test('Spec detail tabs keep the resident icon and slot while naming the focused document', () => {
  assert.match(source, /if \(tab\.page === 'spec'\) return tab\.param \?\s*[\s\S]*?tab\.param/)
  assert.match(source, /specs\?\.find\(\(s\) => s\.id === tab\.param\)\?\.title \|\| tab\.param/)
  assert.match(source, /const icon = isResident\(tab\.page\) \? iconFor\(tab\.page\) : null/)
  assert.match(source, /<button type="button" className="tab-face" data-tip=\{tabLabel\} aria-label=\{tabLabel\}/)
})

test('resource tabs name the resource only, without leaking the owning session title', () => {
  assert.match(source, /return resource\?\.label \|\| key/)
  assert.doesNotMatch(source, /return `\$\{title\} · \$\{resource\?\.label \|\| key\}`/)
})

test('resident issue tabs share the workspace strip and keep the activity rail', () => {
  // Issues and Settings are resident tabs. Issues is the focused reading surface with no workspace dock,
  // but the rail — the top-level board switch — never disappears.
  assert.match(sideBar, /const ENTRIES = RAIL_PAGES/)
  assert.match(sideBar, /<Icon name=\{iconFor\(page\) \|\| page\} size=\{18\} \/>/)
  assert.match(shell, /<SideBar page=\{page\} graphOnly=\{graphOnly\} needsYou=\{needsYou\} \/>/)
  assert.doesNotMatch(shell, /page !== 'issues' && <SideBar/)
  assert.match(shell, /if \(page === 'issues'\) return 'none'/)
})

test('resident tabs and the activity rail share view-owned page icons', () => {
  for (const [page, icon] of [['spec', 'graph'], ['issues', 'issues']]) {
    assert.match(views, new RegExp(`${page}:\\s+\\{[^\\n]*resident: true, icon: '${icon}'`))
  }
  assert.match(builtInViewPlugins, /settings:\s*\{[\s\S]*?resident: true,[\s\S]*?icon: 'settings'/)
  assert.match(views, /registerPlugin\(createSettingsViewPlugin\(SettingsView\)\)/)
  // The rail and the tab strip read the icon from the component-free catalog: asking views.jsx would put
  // TabStrip back inside the view registry's own import cycle.
  assert.match(catalog, /export const iconFor = \(page\) => viewRegistry\.get\(page\)\?\.icon \|\| null/)
  assert.match(source, /import \{ iconFor, isResident \} from '\.\/viewCatalog\.js'/)
  assert.match(source, /const icon = isResident\(tab\.page\) \? iconFor\(tab\.page\) : null/)
  assert.match(source, /<TabKindIcon tab=\{tab\} \/>[\s\S]{0,100}<TabDot tab=\{tab\}/)
  assert.match(css, /\.tab-kind-icon\s*\{[^}]*flex:\s*0 0 13px;/s)
})

test('both dock switches speak the panel vocabulary, and each names the dock it owns', () => {
  // Each switch draws the frame of the panel it OWNS in both states — the sidebar switch the panel-left
  // family, the document's the panel-right family — and says open/closed with the chevron inside that frame,
  // never by drawing the OTHER side's panel. Both glyphs are Lucide's, at the head rows' 14px.
  assert.match(dockToggleSource, /<Icon name=\{dock \? 'panel-left-close' : 'panel-left-open'\} size=\{14\} \/>/)
  assert.match(dockToggleSource, /aria-pressed=\{dock\}/)
  assert.doesNotMatch(dockToggleSource, /panel-right-/)
  assert.doesNotMatch(sideBar, /<DockToggle|name="panel-left"/)   // the rail draws no switch of its own
  const contextToggle = shell.match(/function ContextToggle\([\s\S]*?\n}\n\nexport default function Shell/)
  assert.ok(contextToggle, 'Shell must keep a document-owned context toggle')
  assert.match(contextToggle[0], /className=\{`context-toggle dock-head-act\$\{visible \? ' on' : ''\}`\}/)
  assert.match(contextToggle[0], /<Icon name=\{visible \? 'panel-right-close' : 'panel-right-open'\} size=\{14\} \/>/)
  assert.match(contextToggle[0], /aria-pressed=\{visible\}/)
  assert.doesNotMatch(contextToggle[0], /panel-left|list-checks/)
  // EACH REGION ANSWERS CONTEXT FOR ITS OWN DOCUMENT ([[context-dock]]): one dock per region, drawn by the
  // region, never one shell-level dock that only the routed document can ever describe.
  assert.match(shell, /<ContextDock page=\{route\?\.page\} param=\{route\?\.param\} query=\{route\?\.query\} open=\{hasContext && contextOpen\} \/>/)
  assert.match(shell, /\{hasContext && <div className="context-toggle-slot"><ContextToggle visible=\{contextOpen\} onToggle=\{toggleContext\} \/><\/div>\}/)
  assert.match(shell, /trailing=\{<span className="context-toggle-reservation" aria-hidden="true" \/>\}/)
  assert.match(css, /\.context-toggle-slot\s*\{[^}]*position:\s*absolute;[^}]*right:\s*var\(--space-2\);/s)
  assert.match(css, /\.context-toggle-reservation\s*\{[^}]*flex:\s*0 0 32px;[^}]*width:\s*32px;/s)
  assert.match(css, /\.dock-head-act\s*\{[^}]*width:\s*28px; height:\s*28px;[^}]*padding:\s*0;/s)
  assert.match(css, /\.si-pill\s*\{[^}]*height:\s*28px;/s)
})

test('new-session dock door keeps a compact icon target with a visible keyboard focus ring', () => {
  const dock = readFileSync(new URL('./Dock.jsx', import.meta.url), 'utf8')
  assert.match(dock, /<IconButton icon="plus" size=\{15\}[\s\S]*className="dock-head-act dock-head-act-new"/)
  // keyboard focus is the one shared ring ([[typography]]); the door hand-writes no outline of its own
  assert.match(css, /:focus-visible\s*\{[^}]*box-shadow:\s*var\(--focus-ring\);/)
  assert.doesNotMatch(css, /\.dock-head-act(?:-new)?:focus-visible\s*\{[^}]*outline:/)
  assert.match(css, /\.dock-head-act-new\s*\{[\s\S]*width:\s*24px; height:\s*24px;[\s\S]*background:\s*transparent;[\s\S]*border:\s*1px solid color-mix\(in srgb, var\(--blue\) 72%, var\(--line\)\);[\s\S]*border-radius:\s*var\(--radius\)/)
})

// The strip's law says a second tab of a kind is born from ctrl/⌘-click or a document's own explicit
// "open in a new tab" action — and that the tab which arrives is an ordinary tab. A law each surface
// re-implements is a law each surface can quietly drop — which is what happened: the finding dock appended,
// the Sessions page it was projecting replaced instead.

test('the new-tab gesture is ONE predicate every pointer row surface asks', () => {
  assert.match(tabs, /export const isNewTabGesture = \(event\) => event\.button === 0 && !event\.shiftKey && !event\.altKey/)
  assert.match(tabs, /export function newTabAnchor\(event, href\) \{\n  if \(!isNewTabGesture\(event\)\) return false/)
  for (const [name, src] of [['Dock', dock], ['FileTree', fileTree], ['SessionForestPanel', forest], ['SpecSearch', palette]]) {
    assert.match(src, /isNewTabGesture\(/, `${name} does not ask the shared new-tab predicate`)
  }
  for (const [name, src] of [['Dock', dock], ['FileTree', fileTree], ['SessionForestPanel', forest]]) {
    assert.doesNotMatch(src, /ctrlKey \|\| \w+\.metaKey/, `${name} still hand-rolls a pointer modifier test`)
  }
})

test('asking for a new tab and writing its route are separable halves, and no tab is ever pinned', () => {
  assert.match(tabs, /export function markNewTab\(page, param = null, query = null\)/)
  assert.match(tabs, /export function openNewTab\(page, param = null, query = null\) \{\n  markNewTab\(page, param, query\)\n  navigate\(page, param, \{ query \}\)/)
  // the mark is consumed by the placement that appends; nothing about a tab records how it arrived
  assert.match(tabs, /const mode = appendKey === key \? 'append' : 'slot'/)
  for (const [name, src] of [['tabs', tabs], ['TabStrip', source], ['Dock', dock], ['FileTree', fileTree], ['SessionForestPanel', forest]]) {
    assert.doesNotMatch(src, /\.pinned|pinned:|pinTab|markTabHold|isHoldGesture|holdAnchor/, `${name} still speaks the pinned-tab vocabulary`)
  }
  // the strip draws every tab the same way: no replaceable-slot face, no double-click promotion
  assert.doesNotMatch(source, /' slot'|onDoubleClick/)
  assert.doesNotMatch(css, /\.tab\.slot/)
})

test('a Sessions-page session row keeps the one claimed pointer gesture', () => {
  assert.match(forest, /onClick: \(event\) => selecting \? togglePick\(session\.id\) : onSelect\?\.\(session\.id, \{ newTab: isNewTabGesture\(event\) \}\)/)
  assert.doesNotMatch(forest, /onDoubleClick: \(\) => \{ if \(!selecting\) onSelect/)
  // the new tab is marked on the workspace, while the address itself is still written through the view's scope
  assert.match(sessionsView, /if \(newTab && id !== 'new'\) markNewTab\(route\.page, route\.param, route\.query\)/)
  assert.match(sessionsView, /return scope\.open\(route\)/)
})

test('the session row menu carries the explicit open-in-a-new-tab action', () => {
  assert.match(sessionMenu, /openNewTab\('sessions', id\)/)
  assert.match(sessionMenu, /ContextMenuItem icon="plus" onClick=\{openInNewTab\}>\{t\('tabs\.openInNewTab'\)\}/)
})

test('the palette opens a new tab by pointer and by its keyboard twin', () => {
  assert.match(palette, /const pick = \(e, newTab = false\) => \{ if \(e\) \{ onPick\(e, \{ newTab \}\); onClose\(\) \} \}/)
  assert.match(palette, /pick\(results\[sel\], e\.ctrlKey \|\| e\.metaKey\)/)
  assert.match(palette, /onClick=\{\(event\) => pick\(e, isNewTabGesture\(event\)\)\}/)
  assert.match(shell, /if \(!options\?\.newTab\) return navigateAddress\(hit\?\.address\)/)
  assert.match(shell, /openNewTab\(route\.page, route\.param, route\.query\)/)
})

test('there is no hold chord: nothing in the binding registry or the shell pins a tab', () => {
  assert.doesNotMatch(keymap, /tabHold/)
  assert.doesNotMatch(shell, /tabHold/)
  assert.doesNotMatch(tabs, /hold: \(\) => \{/)
  for (const [name, dict] of [['en', en], ['zh', zh]]) {
    assert.doesNotMatch(dict, /tabHold: '/, `${name} still has a legend line for the retired hold chord`)
  }
})

// THE SECOND REGION ([[workspace-shell]] / [[tab-strip]]'s held slot). Sending a tab right is a MOVE inside
// one working set, and the region that receives it is a place to read a document — not a second workspace.
test('the workspace is a tree of groups, and every move takes a document out of the one it was in', () => {
  // one store for the whole workspace, repaired at the read boundary and written as one tree
  assert.match(tabs, /const KEY = scopedKey\('spexcode\.layout'\)/)
  assert.match(tabs, /layout = normalizeLayout\(readRaw\(\), isDocument\)/)
  // the retired shapes — a flat list, and a list beside a held slot — migrate rather than living on
  assert.match(tabs, /const LEGACY_TABS_KEY = scopedKey\('spexcode\.tabs'\)/)
  assert.match(tabs, /const LEGACY_HELD_KEY = scopedKey\('spexcode\.held'\)/)
  assert.match(tabs, /if \(held\?\.page\) return \{ root: \{ dir: 'row', ratio: 0\.5, children: \[\{ tabs \}, \{ tabs: \[held\] \}\] \} \}/)
  // splitting is a move into a new group; a drag into another group is that move without a new place
  assert.match(tabs, /const next = splitGroup\(held\.root, owner\.id, key, dir\)/)
  assert.match(tabs, /const moved = moveTabToGroup\(held\.root, key, target, before\)/)
  // closing the last tab of a group collapses it; an emptied workspace lands on its explicit place
  assert.match(tabs, /if \(!next\.root\) \{ navigate\('empty'\); return \}/)
  // the focused group owns the address bar, so moving focus names that group's document
  assert.match(tabs, /export function focusGroup\(id, \{ follow = true \} = \{\}\)/)
  assert.doesNotMatch(workspace, /splitTo|closeSplit|SPLIT_KEY/)
})

test('the frame is drawn once: a region holds a document, its band and its own context', () => {
  assert.match(shell, /function DocumentRegion\(\{ group, single, specs, sessions, dock, foldable, inactive, showing = null \}\)/)
  assert.match(shell, /function RegionTree\(\{ node, single, specs, sessions, dock, foldable, inactive, focus = null, showing = null \}\)/)
  // a split is two subtrees sharing one box at the reader's own ratio, with one divider between them
  assert.match(shell, /<div className=\{`region-split region-\$\{node\.dir\}`\}>/)
  assert.match(shell, /resizeWorkspaceSplit\(node\.id, ratio\)/)
  assert.match(shell, /<TabStrip specs=\{specs\} sessions=\{sessions\} route=\{route \|\| \{ page: 'empty', param: null, query: null \}\} group=\{group\.id\}/)
  // every group keeps its own mounted documents, and only the workspace's ONE group may draw page chrome
  assert.match(shell, /<ViewPool group=\{group\} override=\{showing\} inactive=\{inactive\} single=\{single\} \/>/)
  // a route that is not a document — the graph, the launch page — shows in the FOCUSED cell
  assert.match(shell, /showing=\{isDocument\(page, param\) \? null : \{ page, param, query \}\}/)
  assert.match(shell, /primary: single/)
  assert.match(workspace, /export const usePanePrimary = \(\) => useContext\(Pane\)\?\.primary !== false/)
  assert.match(css, /\.region \{[^}]*flex-direction: column;/s)
  assert.match(css, /\.region-body \{[^}]*display: flex;/s)
  assert.match(css, /\.region-split \{[^}]*display: flex;/s)
  assert.match(css, /\.region-col \{ flex-direction: column; \}/)
  assert.match(css, /\.content-divider-h \{ cursor: row-resize; \}/)
  assert.match(workspace, /const HELD_SIDE_KEY = scopedKey\('spexcode\.heldSide'\)/)
  // the second region is not a second workspace: the retired copy-shaped chrome is gone for good
  assert.doesNotMatch(shell, /className="content-split"|className="content-second"|content-close|HeldBar/)
  assert.doesNotMatch(css, /\.content-split|\.content-second|\.content-close/)
})
