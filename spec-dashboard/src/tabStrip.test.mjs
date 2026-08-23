import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./TabStrip.jsx', import.meta.url), 'utf8')

test('tab right-click opens the shared context menu instead of closing silently', () => {
  assert.match(source, /ContextMenuGroup[\s\S]*tabs\.menuClose[\s\S]*tabs\.menuCloseOthers[\s\S]*tabs\.menuSplit/)
  assert.match(source, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); setMenu\(/)
  assert.doesNotMatch(source, /onContextMenu=\{\(e\) => \{ e\.preventDefault\(\); closeOthers\(tab\)/)
})

test('tab menu actions are explicit and use the existing workspace APIs', () => {
  assert.match(source, /close\(menu\.tab\)/)
  assert.match(source, /closeOthers\(menu\.tab\)/)
  assert.match(source, /splitTo\(menu\.tab\)/)
  assert.match(source, /useEscLayer\(!!menu/)
})
