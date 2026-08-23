import test from 'node:test'
import assert from 'node:assert/strict'
import { moveTab, normalizeTabs, placeTab, tabKey } from './tabModel.js'

// [[tab-strip]]'s law, checked without a browser: **a new tab is a gesture, never a side effect.**
// The regression this exists to catch is the one that shipped: browsing minted a tab per click, so a
// reader who clicked five things was holding five documents they never decided to keep.

const spec = (id) => ({ page: 'spec', param: id, query: null })
const session = (id) => ({ page: 'sessions', param: id, query: null })
const keys = (tabs) => tabs.map((t) => `${t.pinned ? '*' : '~'}${tabKey(t)}`)

test('plain navigation reuses one slot per document kind', () => {
  let tabs = []
  for (const id of ['a', 'b', 'c', 'd', 'e']) tabs = placeTab(tabs, spec(id))
  assert.deepEqual(keys(tabs), ['~#/spec/e'])
  // A different kind gets its own slot, so browsing sessions cannot evict the current spec.
  for (const id of ['s1', 's2', 's3']) tabs = placeTab(tabs, session(id))
  assert.deepEqual(keys(tabs), ['~#/spec/e', '~#/sessions/s3'])
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

// A SINGLETON BOARD IS A PLACE. The regression this catches is the one the browser found: a board reached
// by a plain navigation took the slot, so its own first row click replaced the list with the detail — the
// reader asked to read one scenario and lost the list they were reading it from.
test('a resident board is never the slot, and its details still are', () => {
  const resident = (page, param) => (page === 'evals' || page === 'issues') && param == null
  const board = { page: 'evals', param: null, query: null }
  const detail = (name) => ({ page: 'evals', param: `node/${name}`, query: null })
  // however the board was reached, the strip holds it — the caller passes 'pin' for a resident address.
  let tabs = placeTab([], board, 'pin')
  tabs = placeTab(tabs, detail('a'))
  tabs = placeTab(tabs, detail('b'))
  tabs = placeTab(tabs, detail('c'))
  assert.deepEqual(keys(tabs), ['*#/evals', '~#/evals/node/c'])
  // ctrl/⌘ on a row still holds a second detail beside the reused slot
  tabs = placeTab(tabs, detail('d'), 'pin')
  assert.deepEqual(keys(tabs), ['*#/evals', '~#/evals/node/c', '*#/evals/node/d'])
  // a store written before residency existed cannot boot a board into the slot
  const migrated = normalizeTabs([{ page: 'evals', param: null, pinned: false }], resident)
  assert.deepEqual(migrated.map((t) => t.pinned), [true])
  // …and the same store's DETAIL entry keeps the slot it was holding
  const kept = normalizeTabs([{ page: 'evals', param: null, pinned: false }, { page: 'evals', param: 'n/s', pinned: false }], resident)
  assert.deepEqual(kept.map((t) => t.pinned), [true, false])
})

// REORDERING IS A SPLICE, and the properties that matter are the ones a drag can violate: the set of open
// documents never changes, the slot stays the slot wherever it lands, and a drag that goes nowhere writes
// nothing (a new array here would wake every subscriber and rewrite storage for a click).
test('a dragged tab is spliced to its landing place and nothing else moves', () => {
  const strip = ['a', 'b', 'c', 'd'].map((id) => ({ page: 'spec', param: id, query: null, pinned: true }))
  assert.deepEqual(moveTab(strip, '#/spec/d', '#/spec/b').map(tabKey), ['#/spec/a', '#/spec/d', '#/spec/b', '#/spec/c'])
  assert.deepEqual(moveTab(strip, '#/spec/a', null).map(tabKey), ['#/spec/b', '#/spec/c', '#/spec/d', '#/spec/a'])
  assert.deepEqual(moveTab(strip, '#/spec/b', '#/spec/a').map(tabKey), ['#/spec/b', '#/spec/a', '#/spec/c', '#/spec/d'])
  // the working set is invariant under a move: same addresses, same count, same pinned flags
  const moved = moveTab(strip, '#/spec/c', '#/spec/a')
  assert.deepEqual([...moved.map(tabKey)].sort(), [...strip.map(tabKey)].sort())
  assert.deepEqual(moved.map((t) => t.pinned), strip.map((t) => t.pinned))
})

test('a move that changes nothing returns the same array', () => {
  const strip = ['a', 'b', 'c'].map((id) => ({ page: 'spec', param: id, query: null, pinned: true }))
  assert.equal(moveTab(strip, '#/spec/a', '#/spec/b'), strip)   // already in front of b
  assert.equal(moveTab(strip, '#/spec/c', null), strip)         // already last
  assert.equal(moveTab(strip, '#/spec/zz', '#/spec/a'), strip)  // not in the strip
  assert.equal(moveTab(strip, '#/spec/a', '#/spec/zz'), strip)  // landing on nothing
})

test('the slot survives a reorder as the slot, wherever it is dragged', () => {
  let tabs = placeTab(placeTab([], spec('pin1'), 'pin'), spec('slotted'))
  tabs = placeTab(tabs, spec('pin2'), 'pin')
  assert.deepEqual(keys(tabs), ['*#/spec/pin1', '~#/spec/slotted', '*#/spec/pin2'])
  tabs = moveTab(tabs, '#/spec/slotted', '#/spec/pin1')
  assert.deepEqual(keys(tabs), ['~#/spec/slotted', '*#/spec/pin1', '*#/spec/pin2'])
  // and ordinary navigation still lands in it, in its new place
  tabs = placeTab(tabs, spec('next'))
  assert.deepEqual(keys(tabs), ['~#/spec/next', '*#/spec/pin1', '*#/spec/pin2'])
})

test('legacy storage migrates to one slot per document kind', () => {
  // old entries: an unmarked one is resident, a `preview` one is the slot
  assert.deepEqual(normalizeTabs([{ page: 'spec', param: 'a' }, { page: 'spec', param: 'b', preview: true }]),
    [{ page: 'spec', param: 'a', query: null, pinned: true }, { page: 'spec', param: 'b', query: null, pinned: false }])
  // more than one unpinned can only come from a hand-edited store; the last one wins the slot
  const many = normalizeTabs([{ page: 'spec', param: 'a', pinned: false }, { page: 'spec', param: 'b', pinned: false }])
  assert.deepEqual(many.map((t) => t.pinned), [true, false])
  const kinds = normalizeTabs([
    { page: 'spec', param: 'a', pinned: false },
    { page: 'sessions', param: 's1', pinned: false },
  ])
  assert.deepEqual(kinds.map((t) => t.pinned), [false, false])
})
