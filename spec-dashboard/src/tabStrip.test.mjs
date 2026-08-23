import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./TabStrip.jsx', import.meta.url), 'utf8')

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
