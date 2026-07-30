import test from 'node:test'
import assert from 'node:assert/strict'
import { rootSlots, touchRoot } from './root-lru.js'

// [[root-lru]] — the policy that used to be written twice, verbatim in logic and in name, in git.ts and in
// spec-eval's scenariofresh.ts. These lock the parts that made it worth sharing rather than re-typing.

test('an immutable key is shared: a root moving off it evicts only when no sibling still names it', () => {
  const roots = new Map<string, string>()
  const cache = new Map<string, unknown>([['headA', 'workA'], ['headB', 'workB']])

  touchRoot(roots, cache, '/w1', 'headA', 8)
  touchRoot(roots, cache, '/w2', 'headA', 8)          // two checkouts on the SAME commit share one entry
  touchRoot(roots, cache, '/w1', 'headB', 8)          // w1 moves on — w2 is still on headA
  assert.ok(cache.has('headA'), 'a sibling checkout still names headA, so its warm work must survive')

  touchRoot(roots, cache, '/w2', 'headB', 8)          // now nobody wants headA
  assert.ok(!cache.has('headA'), 'the last root left headA, so it is evicted')
  assert.ok(cache.has('headB'))
})

test('re-touching an unchanged root is a recency bump, not a rebuild', () => {
  const roots = new Map<string, string>()
  const cache = new Map<string, unknown>([['h', 1]])
  touchRoot(roots, cache, '/a', 'h', 8)
  touchRoot(roots, cache, '/b', 'h', 8)
  touchRoot(roots, cache, '/a', 'h', 8)               // same key again
  assert.deepEqual([...roots.keys()], ['/b', '/a'], '/a moved to the young end')
  assert.ok(cache.has('h'), 'a bump never drops the entry it is bumping')
})

test('the bound evicts the OLDEST root, and only its key when unreferenced', () => {
  const roots = new Map<string, string>()
  const cache = new Map<string, unknown>()
  for (const n of ['1', '2', '3', '4', '5']) { cache.set(`k${n}`, n); touchRoot(roots, cache, `/r${n}`, `k${n}`, 4) }
  assert.equal(roots.size, 4, 'the slot bound holds')
  assert.ok(!roots.has('/r1'), 'the oldest root went first')
  assert.ok(!cache.has('k1'), 'and its key, which nobody else named, went with it')
  assert.ok(cache.has('k5'))
})

test('rootSlots floors at 4 so no caller can configure the cache into uselessness', () => {
  assert.equal(rootSlots(undefined, 32), 32)          // the caller default when unset
  assert.equal(rootSlots('64', 32), 64)               // env wins
  assert.equal(rootSlots('1', 32), 4)                 // floored
  assert.equal(rootSlots('', 16), 16)                 // empty is unset, not zero
  assert.equal(rootSlots('nonsense', 16), 16)         // unparseable falls back to the caller's default…
  assert.equal(rootSlots('0', 32), 32)                // …as does a value that would disable the bound
  assert.ok(Number.isFinite(rootSlots('nonsense', 16)), 'a bound must never be NaN — `size > NaN` is always false, i.e. no bound at all')
})
