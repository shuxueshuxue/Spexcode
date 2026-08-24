import test from 'node:test'
import assert from 'node:assert/strict'
import { closeDestination, moveTab, normalizeTabs, placeTab, tabKey } from './tabModel.js'

// [[tab-strip]]'s law, checked without a browser: **a new tab is a gesture, never a side effect.**
// The regression this exists to catch is the one that shipped: browsing minted a tab per click, so a
// reader who clicked five things was holding five documents they never decided to keep.

const spec = (id) => ({ page: 'file', param: id, query: null })
const specDocument = (id) => ({ page: 'spec', param: id, query: null })
const session = (id) => ({ page: 'sessions', param: id, query: null })
const keys = (tabs) => tabs.map((t) => `${t.pinned ? '*' : '~'}${tabKey(t)}`)

test('plain navigation reuses one slot per document kind', () => {
  let tabs = []
  for (const id of ['a', 'b', 'c', 'd', 'e']) tabs = placeTab(tabs, spec(id))
  assert.deepEqual(keys(tabs), ['~#/file/e'])
  // A different kind gets its own slot, so browsing sessions cannot evict the current spec.
  for (const id of ['s1', 's2', 's3']) tabs = placeTab(tabs, session(id))
  assert.deepEqual(keys(tabs), ['~#/file/e', '~#/sessions/s3'])
})

test('ctrl/⌘ pins a second tab and the pinned one is never replaced', () => {
  let tabs = placeTab([], spec('a'))                 // slot
  tabs = placeTab(tabs, session('s1'), 'pin')        // explicit hold
  assert.deepEqual(keys(tabs), ['~#/file/a', '*#/sessions/s1'])
  // the slot moves on; the pinned tab stays exactly where it is, address intact
  tabs = placeTab(tabs, spec('b'))
  assert.deepEqual(keys(tabs), ['~#/file/b', '*#/sessions/s1'])
  // and a pinned tab is never the one a plain navigation lands in, even when it is first in the strip
  let pinnedFirst = placeTab([], spec('a'), 'pin')
  pinnedFirst = placeTab(pinnedFirst, spec('b'))
  assert.deepEqual(keys(pinnedFirst), ['*#/file/a', '~#/file/b'])
})

test('the slot keeps its POSITION when its address changes', () => {
  let tabs = placeTab([], spec('pin1'), 'pin')
  tabs = placeTab(tabs, spec('slot'))
  tabs = placeTab(tabs, spec('pin2'), 'pin')
  assert.deepEqual(keys(tabs), ['*#/file/pin1', '~#/file/slot', '*#/file/pin2'])
  tabs = placeTab(tabs, spec('slot2'))
  assert.deepEqual(keys(tabs), ['*#/file/pin1', '~#/file/slot2', '*#/file/pin2'])
})

test('re-opening an address activates it instead of stacking; pinning promotes it in place', () => {
  let tabs = placeTab(placeTab([], spec('a'), 'pin'), spec('b'))
  const before = tabs
  assert.equal(placeTab(tabs, spec('a')), before)          // already open: nothing moves
  tabs = placeTab(tabs, spec('b'), 'pin')                  // double-click on the slot
  assert.deepEqual(keys(tabs), ['*#/file/a', '*#/file/b'])
  // with every tab pinned, the next plain navigation has no slot to reuse and opens one
  tabs = placeTab(tabs, spec('c'))
  assert.deepEqual(keys(tabs), ['*#/file/a', '*#/file/b', '~#/file/c'])
})

test('session surfaces share one tab identity and keep the base address in the strip', () => {
  let tabs = placeTab([], { page: 'sessions', param: 's1', query: { surface: 'terminal' } }, 'pin')
  tabs = placeTab(tabs, { page: 'sessions', param: 's1', query: { surface: 'conversation' } })
  assert.deepEqual(keys(tabs), ['*#/sessions/s1'])
  assert.deepEqual(tabs[0].query, { surface: 'conversation' })
})

test('base session surfaces share identity while resources remain separate file-class tabs', () => {
  const base = { page: 'sessions', param: 's1', query: null }
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' } }
  assert.notEqual(tabKey(base), tabKey(resource))
  const tabs = placeTab([], base, 'pin')
  const withResource = placeTab(tabs, resource)
  assert.equal(withResource.length, 2)
  assert.equal(withResource[0], tabs[0])
  assert.equal(withResource[1].pinned, true)
})

test('resource holds stay pinned after reload normalization and never compete for the file slot', () => {
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' }, pinned: false }
  const normalized = normalizeTabs([resource, { page: 'file', param: 'old.md', query: null, pinned: false }])
  assert.equal(normalized[0].pinned, true)
  assert.equal(normalized[1].pinned, false)
})

test('persisted session face duplicates collapse to one tab and preserve an explicit hold', () => {
  const tabs = normalizeTabs([
    { page: 'sessions', param: 's1', query: { surface: 'terminal' }, pinned: false },
    { page: 'sessions', param: 's1', query: { surface: 'diff' }, pinned: true },
  ])
  assert.deepEqual(tabs.map(tabKey), ['#/sessions/s1'])
  assert.equal(tabs[0].pinned, true)
})

test('resource closing returns to its held session before the new-session page', () => {
  const session = { page: 'sessions', param: 's1', query: null, pinned: true }
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' }, pinned: false }
  assert.deepEqual(closeDestination(resource, [session], 0), session)
})

test('board details normalize to one top-level identity without becoming pinned', () => {
  const isDocument = () => true
  const raw = [
    { page: 'evals', param: null, query: { state: 'open' }, pinned: true },
    { page: 'evals', param: 'node/scenario', pinned: true },
    { page: 'issues', param: null, query: { q: 'needle' }, pinned: true },
    { page: 'settings', param: null, pinned: true },
    { page: 'issues', param: '42', pinned: false },
    { page: 'spec', param: 'node', pinned: false },
  ]
  const tabs = normalizeTabs(raw, isDocument)
  assert.deepEqual(tabs.map(tabKey), ['#/evals', '#/issues', '#/settings', '#/spec'])
  assert.deepEqual(tabs.map(({ page, pinned }) => ({ page, pinned })), [
    { page: 'evals', pinned: false },
    { page: 'issues', pinned: false },
    { page: 'settings', pinned: false },
    { page: 'spec', pinned: false },
  ])
})

test('cold workspace has no board tabs until a route is opened', () => {
  assert.deepEqual(normalizeTabs([]), [])
})

test('an explicit board hold survives reload while legacy pinned faces are demoted', () => {
  const [held, legacy] = normalizeTabs([
    { page: 'issues', param: null, pinned: true, held: true },
    { page: 'evals', param: null, pinned: true },
  ])
  assert.equal(held.pinned, true)
  assert.equal(held.held, true)
  assert.equal(legacy.pinned, false)
})

test('opening a spec keeps its detail address while focusing the dynamic Spec tab', () => {
  let tabs = placeTab([], specDocument('first'))
  assert.deepEqual(tabs.map(tabKey), ['#/spec'])
  assert.deepEqual(tabs[0], { page: 'spec', param: 'first', query: null, pinned: false })
  tabs = placeTab(tabs, specDocument('second'))
  assert.deepEqual(tabs.map(tabKey), ['#/spec'])
  assert.equal(tabs[0].param, 'second')
})

test('opening a scenario or issue creates focused dynamic top-level tabs without pinning them', () => {
  let tabs = placeTab(placeTab([], specDocument('node'), 'pin'), session('s1'), 'pin')
  tabs = placeTab(tabs, { page: 'evals', param: 'node/scenario', query: null })
  tabs = placeTab(tabs, { page: 'issues', param: '42', query: null })
  assert.deepEqual(tabs.map(tabKey), ['#/spec', '#/sessions/s1', '#/evals', '#/issues'])
  assert.deepEqual(tabs.slice(2).map(({ page, param }) => ({ page, param })), [
    { page: 'evals', param: 'node/scenario' },
    { page: 'issues', param: '42' },
  ])
  assert.ok(tabs.slice(2).every((tab) => !tab.pinned))
})

test('opening a spec keeps its detail address while focusing one dynamic Spec tab', () => {
  let tabs = placeTab([], specDocument('first'))
  assert.deepEqual(tabs.map(tabKey), ['#/spec'])
  assert.equal(tabs[0].param, 'first')
  tabs = placeTab(tabs, specDocument('second'))
  assert.deepEqual(tabs.map(tabKey), ['#/spec'])
  assert.equal(tabs[0].param, 'second')
})

// REORDERING IS A SPLICE, and the properties that matter are the ones a drag can violate: the set of open
// documents never changes, the slot stays the slot wherever it lands, and a drag that goes nowhere writes
// nothing (a new array here would wake every subscriber and rewrite storage for a click).
test('a dragged tab is spliced to its landing place and nothing else moves', () => {
  const strip = ['a', 'b', 'c', 'd'].map((id) => ({ page: 'file', param: id, query: null, pinned: true }))
  assert.deepEqual(moveTab(strip, '#/file/d', '#/file/b').map(tabKey), ['#/file/a', '#/file/d', '#/file/b', '#/file/c'])
  assert.deepEqual(moveTab(strip, '#/file/a', null).map(tabKey), ['#/file/b', '#/file/c', '#/file/d', '#/file/a'])
  assert.deepEqual(moveTab(strip, '#/file/b', '#/file/a').map(tabKey), ['#/file/b', '#/file/a', '#/file/c', '#/file/d'])
  // the working set is invariant under a move: same addresses, same count, same pinned flags
  const moved = moveTab(strip, '#/file/c', '#/file/a')
  assert.deepEqual([...moved.map(tabKey)].sort(), [...strip.map(tabKey)].sort())
  assert.deepEqual(moved.map((t) => t.pinned), strip.map((t) => t.pinned))
})

test('a move that changes nothing returns the same array', () => {
  const strip = ['a', 'b', 'c'].map((id) => ({ page: 'file', param: id, query: null, pinned: true }))
  assert.equal(moveTab(strip, '#/file/a', '#/file/b'), strip)   // already in front of b
  assert.equal(moveTab(strip, '#/file/c', null), strip)         // already last
  assert.equal(moveTab(strip, '#/file/zz', '#/file/a'), strip)  // not in the strip
  assert.equal(moveTab(strip, '#/file/a', '#/file/zz'), strip)  // landing on nothing
})

test('the slot survives a reorder as the slot, wherever it is dragged', () => {
  let tabs = placeTab(placeTab([], spec('pin1'), 'pin'), spec('slotted'))
  tabs = placeTab(tabs, spec('pin2'), 'pin')
  assert.deepEqual(keys(tabs), ['*#/file/pin1', '~#/file/slotted', '*#/file/pin2'])
  tabs = moveTab(tabs, '#/file/slotted', '#/file/pin1')
  assert.deepEqual(keys(tabs), ['~#/file/slotted', '*#/file/pin1', '*#/file/pin2'])
  // and ordinary navigation still lands in it, in its new place
  tabs = placeTab(tabs, spec('next'))
  assert.deepEqual(keys(tabs), ['~#/file/next', '*#/file/pin1', '*#/file/pin2'])
})

test('legacy storage migrates to one slot per document kind', () => {
  // old entries: an unmarked one is held, a `preview` one is the slot
  assert.deepEqual(normalizeTabs([{ page: 'file', param: 'a' }, { page: 'file', param: 'b', preview: true }]),
    [{ page: 'file', param: 'a', query: null, pinned: true }, { page: 'file', param: 'b', query: null, pinned: false }])
  // more than one unpinned can only come from a hand-edited store; the last one wins the slot
  const many = normalizeTabs([{ page: 'file', param: 'a', pinned: false }, { page: 'file', param: 'b', pinned: false }])
  assert.deepEqual(many.map((t) => t.pinned), [true, false])
  const kinds = normalizeTabs([
    { page: 'file', param: 'a', pinned: false },
    { page: 'sessions', param: 's1', pinned: false },
  ])
  assert.deepEqual(kinds.map((t) => t.pinned), [false, false])
})

test('closing a session stays in the session identity domain', () => {
  const session = (id) => ({ page: 'sessions', param: id, query: null, pinned: true })
  const remaining = [
    { page: 'spec', param: 'node', query: null, pinned: true },
    session('right'),
    { page: 'file', param: 'README.md', query: null, pinned: true },
  ]
  assert.deepEqual(closeDestination(session('closed'), remaining, 0), session('right'))
  assert.deepEqual(closeDestination(session('closed'), [], 0), { page: 'empty', param: null, query: null })
  assert.deepEqual(closeDestination({ page: 'spec', param: 'node' }, [], 0), { page: 'graph', param: null, query: null })
})
