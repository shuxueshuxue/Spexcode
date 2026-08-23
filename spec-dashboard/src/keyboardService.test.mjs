import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync(new URL('./Shell.jsx', import.meta.url), 'utf8')
const graph = readFileSync(new URL('./GraphView.jsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./workspace.jsx', import.meta.url), 'utf8')

test('help is a shell-owned overlay and remains global across routed views', () => {
  assert.match(workspace, /helpOpen/)
  assert.match(workspace, /toggleHelp/)
  assert.match(shell, /firesKey\('graph\.help', event\.key\)/)
  assert.match(shell, /helpOpen && <Legend/)
  assert.doesNotMatch(graph, /const \[legend, setLegend\]/)
  assert.doesNotMatch(graph, /legend && <Legend/)
})
