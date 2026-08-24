import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./TabStrip.jsx', import.meta.url), 'utf8')
const sideBar = readFileSync(new URL('./SideBar.jsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./Shell.jsx', import.meta.url), 'utf8')
const views = readFileSync(new URL('./views.jsx', import.meta.url), 'utf8')
const builtInViewPlugins = readFileSync(new URL('./builtInViewPlugins.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('tab right-click opens the shared context menu instead of closing silently', () => {
  assert.match(source, /ContextMenuGroup[\s\S]*tabs\.menuClose[\s\S]*tabs\.menuCloseOthers[\s\S]*tabs\.menuSplit/)
  assert.match(source, /onContextMenu=\{\(e\) => \{[^}]*e\.preventDefault\(\); setMenu\(/)
  assert.doesNotMatch(source, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); closeOthers\(tab\)/)
})

test('tab menu actions are explicit and use the existing workspace APIs', () => {
  assert.match(source, /close\(menu\.tab\)/)
  assert.match(source, /closeOthers\(menu\.tab\)/)
  assert.match(source, /splitTo\(menu\.tab\)/)
  assert.match(source, /useEscLayer\(!!menu/)
})

test('the strip enters shrink-wrap mode only when its minimums exceed the row', () => {
  assert.match(source, /new ResizeObserver\(update\)/)
  assert.match(source, /tabs\.length \* 80 > host\.clientWidth/)
  assert.match(source, /tabstrip-tabs\$\{wrapped \? ' wrapped' : ''\}/)
})

test('closing tabs retain their original visual slot while the live list updates', () => {
  assert.match(source, /renderedTabs\.splice\(Math\.max\(0, Math\.min\(entry\.index, renderedTabs\.length\)\)/)
})

test('tab dragging reorders during motion and treats the strip tail as an end landing', () => {
  assert.match(source, /const track = \(point\) => \{[\s\S]{0,260}if \(before !== undefined\) move\(key, before\)[\s\S]{0,180}setDrag/)
  assert.match(source, /tabsHostRef\.current[\s\S]{0,500}getBoundingClientRect\(\)/)
})

test('session tabs use the shared visible title, not the stable search handle', () => {
  assert.match(source, /import \{ STATUS_COLOR, sessionHeadline \} from '\.\/session\.js'/)
  assert.match(source, /const title = s \? sessionHeadline\(s\) : tab\.param\.slice\(0, 8\)/)
})

test('resource tabs name the resource only, without leaking the owning session title', () => {
  assert.match(source, /return resource\?\.label \|\| key/)
  assert.doesNotMatch(source, /return `\$\{title\} · \$\{resource\?\.label \|\| key\}`/)
})

test('resident review tabs share the workspace strip while Issues removes the activity rail', () => {
  // Evals, Issues, and Settings are resident tabs. Issues is the focused full-width reading surface; its
  // detail still has the shared strip, while the activity rail is intentionally omitted.
  assert.match(sideBar, /const ENTRIES = RAIL_PAGES/)
  assert.match(sideBar, /<Icon name=\{iconFor\(page\) \|\| page\} size=\{18\} \/>/)
  assert.match(shell, /page !== 'issues' && <SideBar page=\{page\} needsYou=\{needsYou\} \/>/)
  assert.match(shell, /if \(page === 'issues' \|\| \(page === 'evals' && param == null\)\) return 'none'/)
})

test('resident tabs and the activity rail share view-owned page icons', () => {
  for (const [page, icon] of [['spec', 'graph'], ['evals', 'evals'], ['issues', 'issues']]) {
    assert.match(views, new RegExp(`${page}:\\s+\\{[^\\n]*resident: true, icon: '${icon}'`))
  }
  assert.match(builtInViewPlugins, /settings:\s*\{[\s\S]*?resident: true,[\s\S]*?icon: 'settings'/)
  assert.match(views, /registerPlugin\(createSettingsViewPlugin\(SettingsView\)\)/)
  assert.match(views, /export const iconFor = \(page\) => viewRegistry\.get\(page\)\?\.icon \|\| null/)
  assert.match(source, /const icon = isResident\(tab\.page\) \? iconFor\(tab\.page\) : null/)
  assert.match(source, /<TabKindIcon tab=\{tab\} \/>[\s\S]{0,100}<TabDot tab=\{tab\}/)
  assert.match(css, /\.tab-kind-icon\s*\{[^}]*flex:\s*0 0 13px;/s)
  assert.match(css, /@container \(max-width:\s*100px\)\s*\{[^}]*\.tab-kind-icon, \.tab-dot, \.tab-spinner\s*\{[^}]*display:\s*none;/s)
})

test('left dock and right context controls use distinct semantic glyphs', () => {
  // The rail controls the left finding dock. The document control answers the right context question;
  // reusing panel-right made two different owners look like one duplicated door when both were closed.
  assert.match(sideBar, /<Icon name=\{dock \? 'panel-left' : 'panel-right'\} size=\{18\} \/>/)
  const contextToggle = shell.match(/function ContextToggle\([\s\S]*?\n}\n\nexport default function Shell/)
  assert.ok(contextToggle, 'Shell must keep a document-owned context toggle')
  assert.match(contextToggle[0], /<Icon name="list-checks" size=\{14\} \/>/)
  assert.doesNotMatch(contextToggle[0], /panel-right/)
})

test('new-session dock door keeps a compact icon target with a visible keyboard focus ring', () => {
  const dock = readFileSync(new URL('./Dock.jsx', import.meta.url), 'utf8')
  assert.match(dock, /<IconButton icon="plus" size=\{15\}[\s\S]*className="dock-head-act dock-head-act-new"/)
  assert.match(css, /\.dock-head-act:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--blue\)/)
  assert.match(css, /\.dock-head-act-new\s*\{[\s\S]*width:\s*24px; height:\s*24px;[\s\S]*background:\s*transparent;[\s\S]*border:\s*1px solid color-mix\(in srgb, var\(--blue\) 72%, var\(--line\)\);[\s\S]*border-radius:\s*var\(--radius\)/)
  assert.match(css, /\.dock-head-act-new:focus-visible\s*\{[^}]*outline-offset:\s*2px;/)
})
