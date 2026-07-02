import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ForgeCache } from './cache.js'
import type { ForgeIssue, ForgePR } from './port.js'

const issue = (number: number, over: Partial<ForgeIssue> = {}): ForgeIssue =>
  ({ number, title: `i${number}`, body: '', url: `u${number}`, state: 'open', labels: [], author: 'a', createdAt: 't', comments: [], ...over })
const pr = (number: number): ForgePR => ({ number, title: `p${number}`, url: `u${number}`, state: 'open', headRefName: `node/x-${number}`, closesIssues: [] })

// the freshness invariant, incremental halves: a delta window merged over the map leaves the cache
// identical to a reconcile of that final state — an issue never leaves, a closed one updates in place.
test('cache: applyIssues merges an updated-since window (upsert, close-in-place, never removes)', () => {
  const c = new ForgeCache()
  c.applyIssues([issue(1), issue(2)])
  c.applyIssues([issue(2, { state: 'closed', title: 'i2 done' }), issue(3)])   // 2 closed, 3 new, 1 untouched
  const got = new Map(c.state().issues.map((i) => [i.number, i]))
  assert.equal(got.size, 3)
  assert.equal(got.get(1)!.state, 'open')
  assert.equal(got.get(2)!.state, 'closed')
  assert.equal(got.get(2)!.title, 'i2 done')
  assert.equal(got.get(3)!.state, 'open')
})

test('cache: setPRs replaces the open-PR set whole (full replacement IS its delta)', () => {
  const c = new ForgeCache()
  c.setPRs([pr(1), pr(2)])
  c.setPRs([pr(2), pr(3)])   // 1 merged/closed → gone from the open list
  assert.deepEqual(c.state().prs.map((p) => p.number).sort(), [2, 3])
})
