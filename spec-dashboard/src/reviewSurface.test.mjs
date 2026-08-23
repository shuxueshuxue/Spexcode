import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ReviewSurface.jsx', import.meta.url), 'utf8')

test('Issues review surface has no activity rail while Evals keeps route chrome', () => {
  assert.match(source, /export const reviewShowsActivityRail = \(page\) => page !== 'issues'/)
  assert.match(source, /showActivityRail && <SideBar page=\{page\} hideDockToggle \/>/)
  assert.match(source, /review-surface-no-activity-rail/)
  assert.match(source, /DetailShell's metadata rail[\s\S]*remains part of the issue itself/)
})
