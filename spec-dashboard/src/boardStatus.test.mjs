import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const shell = read('./Shell.jsx')
const graphStats = read('./GraphStats.jsx')
const sideBar = read('./SideBar.jsx')

test('the shell owns one complete board ledger on every route', () => {
  assert.match(shell, /function BoardStatus\(\{ specs, sessions, page \}\)/)
  assert.match(shell, /<BoardStatus specs=\{specs\} sessions=\{sessions\} page=\{page\} \/>/)
  assert.doesNotMatch(shell, /quiet=\{page === 'graph'\}/)
  assert.match(shell, /const SCORE_VIEW = \[[\s\S]*'pass'[\s\S]*'fail'[\s\S]*'stalePass'[\s\S]*'staleFail'[\s\S]*'empty'/)
  for (const id of ['board-nodes', 'board-evals', 'board-issues', 'board-sessions']) {
    assert.equal((shell.match(new RegExp(`id: '${id}'`, 'g')) || []).length, 1, `${id} has one owner`)
  }
})

test('the retired graph contribution keeps only the shared walk step', () => {
  assert.match(graphStats, /nextGraphStatNode = \(ids, focusId\) => cycleNext\(ids, focusId\)/)
  assert.doesNotMatch(graphStats, /useStatusItem|id: 'graph-stats'|className="graph-stats"/)
})

test('project switching has one compact owner in the status row', () => {
  assert.match(shell, /className="sb-project-trigger"|className=\{open \? 'sb-project-trigger open'/)
  assert.match(shell, /<IdentityIcon icon=\{identity\?\.icon\} size=\{14\}/)
  assert.match(shell, /className="proj-menu status-project-menu" role="menu"/)
  assert.match(shell, /href=\{hubHref\(\)\}/)
  assert.doesNotMatch(sideBar, /ProjectChip|proj-chip|IdentityIcon|projectHref|hubHref/)
})
