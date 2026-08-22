import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTabs, placeTab, tabKey } from './tabModel.js'

// [[tab-strip]]'s law, checked without a browser: **a new tab is a gesture, never a side effect.**
// The regression this exists to catch is the one that shipped: browsing minted a tab per click, so a
// reader who clicked five things was holding five documents they never decided to keep.

const spec = (id) => ({ page: 'spec', param: id, query: null })
const session = (id) => ({ page: 'sessions', param: id, query: null })
const keys = (tabs) => tabs.map((t) => `${t.pinned ? '*' : '~'}${tabKey(t)}`)

test('plain navigation reuses ONE slot, whatever kind of document it opens', () => {
  let tabs = []
  for (const id of ['a', 'b', 'c', 'd', 'e']) tabs = placeTab(tabs, spec(id))
  assert.deepEqual(keys(tabs), ['~#/spec/e'])
  // sessions are not a special kind: the old type fence made every session click resident, which is how
  // three dock clicks became three tabs.
  for (const id of ['s1', 's2', 's3']) tabs = placeTab(tabs, session(id))
  assert.deepEqual(keys(tabs), ['~#/sessions/s3'])
})

test('ctrl/⌘ pins a second tab and the pinned one is never replaced', () => {
  let tabs = placeTab([], spec('a'))                 // slot
  tabs = placeTab(tabs, session('s1'), 'pin')        // explicit hold
  assert.deepEqual(keys(tabs), ['~#/spec/a', '*#/sessions/s1'])
  // the slot moves on; the pinned tab stays exactly where it is, address intact
  tabs = placeTab(tabs, spec('b'))
  assert.deepEqual(keys(tabs), ['~#/spec/b', '*#/sessions/s1'])
  // and a pinned tab is never the one a plain navigation lands in, even when it is first in the strip
  let pinnedFirst = placeTab([], spec('a'), 'pin')
  pinnedFirst = placeTab(pinnedFirst, spec('b'))
  assert.deepEqual(keys(pinnedFirst), ['*#/spec/a', '~#/spec/b'])
})

test('the slot keeps its POSITION when its address changes', () => {
  let tabs = placeTab([], spec('pin1'), 'pin')
  tabs = placeTab(tabs, spec('slot'))
  tabs = placeTab(tabs, spec('pin2'), 'pin')
  assert.deepEqual(keys(tabs), ['*#/spec/pin1', '~#/spec/slot', '*#/spec/pin2'])
  tabs = placeTab(tabs, spec('slot2'))
  assert.deepEqual(keys(tabs), ['*#/spec/pin1', '~#/spec/slot2', '*#/spec/pin2'])
})

test('re-opening an address activates it instead of stacking; pinning promotes it in place', () => {
  let tabs = placeTab(placeTab([], spec('a'), 'pin'), spec('b'))
  const before = tabs
  assert.equal(placeTab(tabs, spec('a')), before)          // already open: nothing moves
  tabs = placeTab(tabs, spec('b'), 'pin')                  // double-click on the slot
  assert.deepEqual(keys(tabs), ['*#/spec/a', '*#/spec/b'])
  // with every tab pinned, the next plain navigation has no slot to reuse and opens one
  tabs = placeTab(tabs, spec('c'))
  assert.deepEqual(keys(tabs), ['*#/spec/a', '*#/spec/b', '~#/spec/c'])
})

test('a query is part of the identity, so two faces of one session are two addresses', () => {
  let tabs = placeTab([], { page: 'sessions', param: 's1', query: { surface: 'terminal' } }, 'pin')
  tabs = placeTab(tabs, { page: 'sessions', param: 's1', query: { surface: 'conversation' } })
  assert.deepEqual(keys(tabs), ['*#/sessions/s1?surface=terminal', '~#/sessions/s1?surface=conversation'])
})

test('legacy storage migrates to exactly one slot', () => {
  // old entries: an unmarked one is resident, a `preview` one is the slot
  assert.deepEqual(normalizeTabs([{ page: 'spec', param: 'a' }, { page: 'spec', param: 'b', preview: true }]),
    [{ page: 'spec', param: 'a', query: null, pinned: true }, { page: 'spec', param: 'b', query: null, pinned: false }])
  // more than one unpinned can only come from a hand-edited store; the last one wins the slot
  const many = normalizeTabs([{ page: 'spec', param: 'a', pinned: false }, { page: 'spec', param: 'b', pinned: false }])
  assert.deepEqual(many.map((t) => t.pinned), [true, false])
})
