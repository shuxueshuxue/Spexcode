import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

const shell = read('./Shell.jsx')
const graphStats = read('./GraphStats.jsx')
const graphView = read('./GraphView.jsx')
const root = read('./Root.jsx')
const app = read('./App.jsx')
const shellSource = shell
const keepAlive = read('../test/keep-alive.e2e.mjs')
const bandBudget = read('../test/band-budget.e2e.mjs')

test('public graph and workspace status mounts are mutually exclusive and complete', () => {
  // PublicGraphAbout registers its disclosure through the same provider; the shell owns the only footer
  // element. The public branch and normal branch each render one footer, never two competing bars.
  assert.equal((shell.match(/<StatusBar \/>/g) || []).length, 2, 'Shell has one public and one normal status footer')
  assert.match(shell, /if \(graphOnly\) \{[\s\S]*?<StatusBar \/>[\s\S]*?return \(/)
  assert.match(shell, /<BoardStatus specs=\{specs\} sessions=\{sessions\} page=\{page\} \/>/)
  assert.doesNotMatch(graphStats, /useStatusItem|id:\s*['"]graph-stats['"]|className=["']graph-stats/)
  assert.doesNotMatch(app, /<ReviewSurface|surface\s*===\s*['"]review['"]/)
  assert.match(root, /<StatusBarProvider>/)
  assert.match(shellSource, /<StatusBar \/>/)
  assert.match(graphView, /graphOnly && <PublicGraphAbout \/>/)
})

test('band and keep-alive budgets are executable contracts, not prose-only numbers', () => {
  assert.match(bandBudget, /const railBand = \(state\) => state\.R === 'issues' \? 0 : 1/)
  assert.match(bandBudget, /const B = \(state\) => railBand\(state\) \+ dockBand\(state\) \+ 1 \/\* tabstrip \*\/ \+ 1 \/\* statusbar \*\/ \+ contextBand\(state\)/)
  assert.match(bandBudget, /Math\.min\(\.\.\.all\.map\(B\)\).*2/)
  assert.match(bandBudget, /Math\.max\(\.\.\.all\.map\(B\)\).*5/)
  assert.match(keepAlive, /const SCRIPT_BUDGET = 0\.05/)
  assert.match(keepAlive, /pool\.seconds <= SCRIPT_BUDGET/)
  assert.match(keepAlive, /document\.querySelectorAll\('\.viewhost'\)\.length/)
})
