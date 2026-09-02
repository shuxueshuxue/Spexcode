import test from 'node:test'
import assert from 'node:assert/strict'
import { closeDestination, focusTab, moveTab, normalizeTabs, placeTab, tabKey } from './tabModel.js'

// [[tab-strip]]'s law, checked without a browser: **a new tab is a gesture, never a side effect** — and the
// tab a gesture mints is an ordinary tab. The two regressions this exists to catch both shipped: browsing
// minted a tab per click, so a reader who clicked five things was holding five documents they never decided
// to keep; then the cure over-corrected, and a tab that arrived by ctrl-click or by creating a session was
// pinned forever, so a plain click on another session appended beside it for the rest of the reader's life.

const file = (id) => ({ page: 'file', param: id, query: null })
const specDocument = (id) => ({ page: 'spec', param: id, query: null })
const session = (id) => ({ page: 'sessions', param: id, query: null })
const keys = (tabs) => tabs.map(tabKey)
// the strip as the hook drives it: every navigation names the tab that was focused before it
const browse = (tabs, ...routes) => {
  let focused = tabs.length ? tabKey(tabs[tabs.length - 1]) : null
  for (const route of routes) {
    const mode = route.append ? 'append' : 'slot'
    tabs = placeTab(tabs, route, mode, focused)
    focused = tabKey(route)
  }
  return tabs
}
const append = (route) => ({ ...route, append: true })

test('plain navigation replaces the focused tab of the same kind', () => {
  let tabs = []
  for (const id of ['a', 'b', 'c', 'd', 'e']) tabs = browse(tabs, file(id))
  assert.deepEqual(keys(tabs), ['#/file/e'])
  // A different kind gets its own tab, so browsing sessions cannot evict the current file.
  for (const id of ['s1', 's2', 's3']) tabs = browse(tabs, session(id))
  assert.deepEqual(keys(tabs), ['#/file/e', '#/sessions/s3'])
})

test('plain navigation never replaces an inactive tab of the same kind', () => {
  let tabs = browse([], session('s1'), specDocument('node'))
  // The session tab is no longer focused; opening another session preserves it and appends a new tab.
  tabs = placeTab(tabs, session('s2'), 'slot', tabKey(specDocument('node')))
  assert.deepEqual(keys(tabs), ['#/sessions/s1', '#/spec', '#/sessions/s2'])
  // Once the new session is focused, same-kind navigation replaces that focused tab.
  tabs = placeTab(tabs, session('s3'), 'slot', tabKey(session('s2')))
  assert.deepEqual(keys(tabs), ['#/sessions/s1', '#/spec', '#/sessions/s3'])
})

test('with no focused tab, a new address is appended — never a guess at which tab to evict', () => {
  const tabs = [session('s1'), file('a')]
  // a cold deep link, or a navigation from a non-document route (the graph, the launch page)
  assert.deepEqual(keys(placeTab(tabs, session('s2'))), ['#/sessions/s1', '#/file/a', '#/sessions/s2'])
  assert.deepEqual(keys(placeTab(tabs, session('s2'), 'slot', '#/graph')), ['#/sessions/s1', '#/file/a', '#/sessions/s2'])
})

test('ctrl/⌘ appends a second tab, and that tab is an ordinary tab', () => {
  let tabs = browse([], file('a'), append(session('s1')))
  assert.deepEqual(keys(tabs), ['#/file/a', '#/sessions/s1'])
  // the appended session is focused and unprotected: the next plain session click replaces IT, not the file
  tabs = browse(tabs, session('s2'))
  assert.deepEqual(keys(tabs), ['#/file/a', '#/sessions/s2'])
  // a same-kind append keeps the focused tab and adds beside it
  tabs = browse(tabs, append(session('s3')))
  assert.deepEqual(keys(tabs), ['#/file/a', '#/sessions/s2', '#/sessions/s3'])
  // and nothing about the tab remembers how it arrived
  assert.deepEqual(tabs[2], session('s3'))
})

test('a created session is appended beside the tab the reader was on, then behaves like any tab', () => {
  let tabs = browse([], session('a'))
  tabs = browse(tabs, append(session('created')))           // the composer marks the published id
  assert.deepEqual(keys(tabs), ['#/sessions/a', '#/sessions/created'])
  tabs = browse(tabs, session('b'))                          // a plain click while the created one is focused
  assert.deepEqual(keys(tabs), ['#/sessions/a', '#/sessions/b'])
})

test('the focused tab keeps its POSITION when its address changes', () => {
  let tabs = browse([], file('left'), append(file('mid')), append(file('right')))
  assert.deepEqual(keys(tabs), ['#/file/left', '#/file/mid', '#/file/right'])
  tabs = placeTab(tabs, file('mid2'), 'slot', tabKey(file('mid')))
  assert.deepEqual(keys(tabs), ['#/file/left', '#/file/mid2', '#/file/right'])
})

test('re-opening an address activates it instead of stacking', () => {
  const tabs = browse([], file('a'), append(file('b')))
  assert.equal(placeTab(tabs, file('a'), 'slot', tabKey(file('b'))), tabs)   // already open: nothing moves
  assert.equal(placeTab(tabs, file('a'), 'append', tabKey(file('b'))), tabs) // an append of an open address is a focus
})

test('session surfaces share one tab identity and keep the base address in the strip', () => {
  let tabs = placeTab([], { page: 'sessions', param: 's1', query: { surface: 'terminal' } })
  tabs = placeTab(tabs, { page: 'sessions', param: 's1', query: { surface: 'conversation' } }, 'slot', '#/sessions/s1')
  assert.deepEqual(keys(tabs), ['#/sessions/s1'])
  assert.deepEqual(tabs[0].query, { surface: 'conversation' })
})

test('base session surfaces share identity while resources are separate file-class tabs', () => {
  const base = session('s1')
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' } }
  assert.notEqual(tabKey(base), tabKey(resource))
  // opened from the session document: the session tab is focused, the resource is a file-kind tab, so it
  // lands beside the session rather than replacing it
  const withResource = placeTab([base], resource, 'slot', tabKey(base))
  assert.deepEqual(withResource, [base, resource])
  // and like every tab it is replaced by the next same-kind plain navigation while it is focused
  const next = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:CHANGELOG.md' } }
  assert.deepEqual(placeTab(withResource, next, 'slot', tabKey(resource)), [base, next])
})

test('persisted marks from older releases are dropped, and duplicates collapse to one tab', () => {
  const tabs = normalizeTabs([
    { page: 'sessions', param: 's1', query: { surface: 'terminal' }, pinned: false },
    { page: 'sessions', param: 's1', query: { surface: 'diff' }, pinned: true, held: true },
    { page: 'file', param: 'a' },
    { page: 'file', param: 'b', preview: true },
    { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' }, pinned: true },
  ])
  assert.deepEqual(tabs, [
    { page: 'sessions', param: 's1', query: { surface: 'terminal' } },
    { page: 'file', param: 'a', query: null },
    { page: 'file', param: 'b', query: null },
    { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' } },
  ])
  assert.ok(tabs.every((tab) => !('pinned' in tab) && !('held' in tab) && !('preview' in tab)))
})

test('session tab titles are presentation metadata that survive the persisted tab normalization', () => {
  const tabs = normalizeTabs([
    { page: 'sessions', param: 'closed-session', query: null, title: 'Closed session' },
    { page: 'file', param: 'README.md', query: null, title: 'ignored on non-session tabs' },
  ])
  assert.deepEqual(tabs[0], { page: 'sessions', param: 'closed-session', query: null, title: 'Closed session' })
  assert.deepEqual(tabs[1], { page: 'file', param: 'README.md', query: null })
})

test('resource closing returns to its session before the new-session page', () => {
  const owner = session('s1')
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' } }
  assert.deepEqual(closeDestination(resource, [owner], 0), owner)
  assert.deepEqual(closeDestination(resource, [owner, specDocument('node')], 0, ['#/spec/node']), owner)
})

test('board details normalize to one top-level identity', () => {
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
  assert.deepEqual(keys(tabs), ['#/evals', '#/issues', '#/settings', '#/spec'])
})

test('cold workspace has no board tabs until a route is opened', () => {
  assert.deepEqual(normalizeTabs([]), [])
})

test('opening a spec keeps its detail address while focusing the one Spec tab', () => {
  let tabs = placeTab([], specDocument('first'))
  assert.deepEqual(keys(tabs), ['#/spec'])
  assert.deepEqual(tabs[0], { page: 'spec', param: 'first', query: null })
  tabs = placeTab(tabs, specDocument('second'), 'slot', '#/spec')
  assert.deepEqual(keys(tabs), ['#/spec'])
  assert.equal(tabs[0].param, 'second')
})

test('opening a scenario or issue creates focused top-level tabs without evicting documents', () => {
  let tabs = browse([], specDocument('node'), append(session('s1')))
  tabs = browse(tabs, { page: 'evals', param: 'node/scenario', query: null }, { page: 'issues', param: '42', query: null })
  assert.deepEqual(keys(tabs), ['#/spec', '#/sessions/s1', '#/evals', '#/issues'])
  assert.deepEqual(tabs.slice(2).map(({ page, param }) => ({ page, param })), [
    { page: 'evals', param: 'node/scenario' },
    { page: 'issues', param: '42' },
  ])
})

// REORDERING IS A SPLICE, and the properties that matter are the ones a drag can violate: the set of open
// documents never changes, and a drag that goes nowhere writes nothing (a new array here would wake every
// subscriber and rewrite storage for a click).
test('a dragged tab is spliced to its landing place and nothing else moves', () => {
  const strip = ['a', 'b', 'c', 'd'].map(file)
  assert.deepEqual(keys(moveTab(strip, '#/file/d', '#/file/b')), ['#/file/a', '#/file/d', '#/file/b', '#/file/c'])
  assert.deepEqual(keys(moveTab(strip, '#/file/a', null)), ['#/file/b', '#/file/c', '#/file/d', '#/file/a'])
  assert.deepEqual(keys(moveTab(strip, '#/file/b', '#/file/a')), ['#/file/b', '#/file/a', '#/file/c', '#/file/d'])
  // the working set is invariant under a move: same addresses, same count
  const moved = moveTab(strip, '#/file/c', '#/file/a')
  assert.deepEqual([...keys(moved)].sort(), [...keys(strip)].sort())
})

test('a move that changes nothing returns the same array', () => {
  const strip = ['a', 'b', 'c'].map(file)
  assert.equal(moveTab(strip, '#/file/a', '#/file/b'), strip)   // already in front of b
  assert.equal(moveTab(strip, '#/file/c', null), strip)         // already last
  assert.equal(moveTab(strip, '#/file/zz', '#/file/a'), strip)  // not in the strip
  assert.equal(moveTab(strip, '#/file/a', '#/file/zz'), strip)  // landing on nothing
})

test('the focused tab is found by identity, not by position, so a reorder does not change what a click replaces', () => {
  let tabs = browse([], file('one'), append(file('two')), append(file('three')))
  tabs = moveTab(tabs, '#/file/three', '#/file/one')
  assert.deepEqual(keys(tabs), ['#/file/three', '#/file/one', '#/file/two'])
  // `three` is still the focused tab; ordinary navigation lands in it, in its new place
  tabs = placeTab(tabs, file('next'), 'slot', '#/file/three')
  assert.deepEqual(keys(tabs), ['#/file/next', '#/file/one', '#/file/two'])
})

test('closing a session stays in the session identity domain', () => {
  const remaining = [specDocument('node'), session('right'), file('README.md')]
  assert.deepEqual(closeDestination(session('closed'), remaining, 0), session('right'))
  assert.deepEqual(closeDestination(session('closed'), [], 0), { page: 'empty', param: null, query: null })
  assert.deepEqual(closeDestination({ page: 'spec', param: 'node' }, [], 0), { page: 'graph', param: null, query: null })
})

test('closing returns to the last-focused tab across kinds before falling back to same-kind position', () => {
  const board = (page) => ({ page, param: null, query: null })
  const recent = (...tabs) => tabs.map(tabKey)

  // SAME KIND, LAST FOCUSED: the file the reader came from wins over a nearer file they have not looked at
  assert.deepEqual(closeDestination(file('x'), [file('L'), session('s'), file('RR')], 1, recent(file('x'), file('RR'), file('L'))), file('RR'))
  // CROSS KIND, LAST FOCUSED: the Spec the reader came from beats an unrelated session file survivor
  assert.deepEqual(closeDestination(file('x'), [file('L'), session('s')], 1, recent(file('x'), session('s'))), session('s'))
  // The same rule applies when the unrelated file is a published session resource.
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' } }
  assert.deepEqual(closeDestination(file('eval.md'), [resource, specDocument('node')], 1,
    recent(file('eval.md'), specDocument('node'), resource)), specDocument('node'))
  // NO SAME-KIND SURVIVOR: the last-focused tab of any kind, not the positional neighbor
  assert.deepEqual(closeDestination(file('x'), [session('a'), board('evals'), session('b')], 1, recent(file('x'), session('b'), session('a'))), session('b'))
  // history naming tabs that already left the strip is skipped, never trusted
  assert.deepEqual(closeDestination(file('x'), [file('L'), file('R')], 1, recent(file('x'), file('gone'), file('L'))), file('L'))
  // a closed non-focused key in the history does not resurrect it: only survivors inherit
  assert.deepEqual(closeDestination(session('x'), [board('issues')], 0, recent(session('x'), session('closed-earlier'))), board('issues'))
})

test('closing with no focus history lands on the nearest same-kind tab, then the nearest of any kind, and leaves only from an empty strip', () => {
  const board = (page) => ({ page, param: null, query: null })

  // RIGHT wins the distance tie between two same-kind neighbors
  assert.deepEqual(closeDestination(file('x'), [file('L'), file('R')], 1), file('R'))
  // the nearer LEFT same-kind tab beats a farther right one — distance, not scan direction
  assert.deepEqual(closeDestination(file('x'), [file('L'), session('s'), file('RR')], 1), file('L'))
  // CROSS-KIND: no same-kind survivor → the nearest tab of any kind inherits (a file close no longer
  // conjures the graph while other tabs remain)
  assert.deepEqual(closeDestination(file('x'), [session('s'), board('evals')], 1), board('evals'))
  assert.deepEqual(closeDestination(session('x'), [board('issues')], 0), board('issues'))
  // LAST TAB: only an emptied strip leaves the workspace, each kind to its standing no-tab destination
  assert.deepEqual(closeDestination(file('x'), [], 0), { page: 'graph', param: null, query: null })
  assert.deepEqual(closeDestination(session('x'), [], 0), { page: 'empty', param: null, query: null })
  const resource = { page: 'sessions', param: 's1', query: { surface: 'resource:s1:file:README.md' } }
  assert.deepEqual(closeDestination(resource, [], 0), { page: 'sessions', param: 'new', query: null })
  assert.deepEqual(closeDestination(board('evals'), [], 0), { page: 'empty', param: null, query: null })
})

test('focusTab resolves one-based ordinals and maps 9 to the last tab', () => {
  const tabs = [session('a'), file('b'), specDocument('c')]
  assert.deepEqual(focusTab(tabs, 1), tabs[0])
  assert.deepEqual(focusTab(tabs, 2), tabs[1])
  assert.deepEqual(focusTab(tabs, 9), tabs[2])
  assert.equal(focusTab(tabs, 4), null)
  assert.equal(focusTab(tabs, 0), null)
})
