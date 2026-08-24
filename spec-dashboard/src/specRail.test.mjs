import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { RAIL_PAGES, routeHash } from './route.js'

const sideBar = readFileSync(new URL('./SideBar.jsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./Shell.jsx', import.meta.url), 'utf8')

test('Spec is a top-level rail destination and owns the selected state for Spec documents', () => {
  assert.deepEqual(RAIL_PAGES, ['spec', 'sessions', 'evals', 'issues', 'settings'])
  assert.equal(routeHash('spec'), '#/spec')
  assert.match(sideBar, /p === 'spec' && page === 'file'/)
  assert.match(sideBar, /focusLatestTab\(\(tab\) => tab\.page === 'spec'\)/)
  assert.match(shell, /page !== 'issues' && <SideBar page=\{page\} needsYou=\{needsYou\} hideDockToggle=\{page === 'sessions'\} \/>/)
})
