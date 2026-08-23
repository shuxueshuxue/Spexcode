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

test('session tabs use the shared visible title, not the stable search handle', () => {
  assert.match(source, /import \{ STATUS_COLOR, sessionHeadline \} from '\.\/session\.js'/)
  assert.match(source, /const title = s \? sessionHeadline\(s\) : tab\.param\.slice\(0, 8\)/)
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
