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
const dock = readFileSync(new URL('./Dock.jsx', import.meta.url), 'utf8')
const fileTree = readFileSync(new URL('./FileTree.jsx', import.meta.url), 'utf8')
const forest = readFileSync(new URL('./SessionForestPanel.jsx', import.meta.url), 'utf8')
const sessionsView = readFileSync(new URL('./SessionsView.jsx', import.meta.url), 'utf8')
const sessionMenu = readFileSync(new URL('./SessionContextMenu.jsx', import.meta.url), 'utf8')
const palette = readFileSync(new URL('./SpecSearch.jsx', import.meta.url), 'utf8')
const keymap = readFileSync(new URL('./keymap.js', import.meta.url), 'utf8')
const en = readFileSync(new URL('./i18n/en.js', import.meta.url), 'utf8')
const zh = readFileSync(new URL('./i18n/zh.js', import.meta.url), 'utf8')

test('tab right-click opens the shared context menu instead of closing silently', () => {
  assert.match(source, /ContextMenuGroup[\s\S]*tabs\.menuClose[\s\S]*tabs\.menuCloseOthers[\s\S]*tabs\.menuSplit/)
  assert.match(source, /onContextMenu=\{\(e\) => \{[\s\S]*?e\.preventDefault\(\)[\s\S]*?setMenu\(null\)/)
  assert.match(source, /onSessionContextMenu\(\{ x: e\.clientX, y: e\.clientY, session \}\)/)
  assert.doesNotMatch(source, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); closeOthers\(tab\)/)
})

test('tab menu actions are explicit and use the existing workspace APIs', () => {
  assert.match(source, /close\(menu\.tab\)/)
  assert.match(source, /closeOthers\(menu\.tab\)/)
  assert.match(source, /splitTo\(menu\.tab\)/)
  assert.match(source, /useEscLayer\(!!menu/)
})

test('ordinary navigation names the focused tab so an inactive tab cannot be replaced', () => {
  assert.match(tabs, /let focusedKey = null/)
  assert.match(tabs, /const priorKey = focusedKey\n    focusedKey = key/)
  assert.match(tabs, /placeTab\(getTabs\(\), route, mode, priorKey\)/)
})

test('the strip enters shrink-wrap mode only when its minimums exceed the row', () => {
  assert.match(source, /new ResizeObserver\(update\)/)
  assert.match(source, /tabs\.length \* TAB_WRAP_FLOOR > host\.clientWidth/)
  assert.match(source, /tabstrip-tabs\$\{wrapped \? ' wrapped' : ''\}/)
})

test('closing tabs retain their original visual slot while the live list updates', () => {
  assert.match(source, /renderedTabs\.splice\(Math\.max\(0, Math\.min\(entry\.index, renderedTabs\.length\)\)/)
})

test('tab dragging reorders during motion and treats the strip tail as an end landing', () => {
  assert.match(source, /const track = \(point\) => \{[\s\S]{0,260}if \(before !== undefined\) move\(key, before\)[\s\S]{0,180}setDrag/)
  assert.match(source, /tabsHostRef\.current[\s\S]{0,500}getBoundingClientRect\(\)/)
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

test('resident review tabs share the workspace strip and every board keeps the activity rail', () => {
  // Evals, Issues, and Settings are resident tabs. Issues is the focused reading surface with no workspace
  // dock, but the rail — the top-level board switch — never disappears under any board.
  assert.match(sideBar, /const ENTRIES = RAIL_PAGES/)
  assert.match(sideBar, /<Icon name=\{iconFor\(page\) \|\| page\} size=\{18\} \/>/)
  assert.match(shell, /<SideBar page=\{page\} needsYou=\{needsYou\} hideDockToggle=\{!foldable\} \/>/)
  assert.doesNotMatch(shell, /page !== 'issues' && <SideBar/)
  assert.match(shell, /if \(page === 'issues' \|\| page === 'evals'\) return 'none'/)
})

test('resident tabs and the activity rail share view-owned page icons', () => {
  for (const [page, icon] of [['spec', 'graph'], ['evals', 'evals'], ['issues', 'issues']]) {
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
  assert.match(css, /@container \(max-width:\s*100px\)\s*\{[^}]*\.tab-kind-icon, \.tab-dot, \.tab-spinner\s*\{[^}]*display:\s*none;/s)
})

test('both dock switches speak the panel vocabulary, and each names the dock it owns', () => {
  // The rail owns the LEFT dock and flips the mirrored pair as that dock's layout state. The document
  // control owns the RIGHT dock and holds `panel-right` fixed: the pair has no empty-frame member, so a
  // flipping right-dock switch would draw `panel-left` — a panel on the wrong side — to say "closed".
  // Its state is `aria-pressed` plus the `.on` tint, never a glyph that pictures the other region.
  assert.match(sideBar, /<Icon name=\{dock \? 'panel-left' : 'panel-right'\} size=\{18\} \/>/)
  const contextToggle = shell.match(/function ContextToggle\([\s\S]*?\n}\n\nexport default function Shell/)
  assert.ok(contextToggle, 'Shell must keep a document-owned context toggle')
  assert.match(contextToggle[0], /<Icon name="panel-right" size=\{14\} \/>/)
  assert.match(contextToggle[0], /aria-pressed=\{visible\}/)
  assert.doesNotMatch(contextToggle[0], /panel-left|list-checks/)
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
  assert.doesNotMatch(shell, /tabHold|runTabCommand\('hold'\)/)
  assert.doesNotMatch(tabs, /hold: \(\) => \{/)
  for (const [name, dict] of [['en', en], ['zh', zh]]) {
    assert.doesNotMatch(dict, /tabHold: '/, `${name} still has a legend line for the retired hold chord`)
  }
})
