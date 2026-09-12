import { routeHash } from './route.js'

// [[tab-strip]]'s semantics, as pure functions — no React, no view registry, no storage. The strip's one
// law ("a new tab is a gesture, never a side effect") is a property of these two functions, so it can be
// checked without a browser. It is here rather than in `tabs.js` for exactly that reason: the hook needs
// the view registry, the registry is JSX, and a rule nobody can test in isolation is a rule that drifts.

// A tab's identity is the object address, minus whatever part of that address is a SELECTOR rather than a
// document. Base session faces are selectors: changing `?surface=conversation|terminal|diff` must update the
// URL without replacing or multiplying the session tab. A resident BOARD's detail is a selector too — the
// strip names the board, never the selection, so two issue tabs would be a strip nobody can read.
// Published resources are the exception among session queries: they are file-class workspace objects, so
// their resource selector remains in the identity — a resource and its session are two tabs, not two faces.
export const isResourceRoute = (route) => route?.page === 'sessions' && typeof route?.query?.surface === 'string'
  && route.query.surface.startsWith('resource:')
export const tabKind = (route) => isResourceRoute(route) ? 'file' : route?.page
// A BOARD collapses its detail; SPEC DOES NOT. `#/spec/<id>` is a document — the strip already names it by
// the node's own title — so its id belongs in its identity exactly as a file's path does. Collapsing it was
// redundant with `placeTab`'s focused-same-kind replacement, which is what actually keeps browsing the graph
// from minting a tab per node, and it cost the strip its headline law: no gesture could mint a second Spec
// tab, so "open in a new tab" on a spec silently overwrote the document the reader was reading. A spec's
// query is a face (`?surface=diff`, its pending change; `?version=<hash>`, a past version) and is dropped
// exactly like a session face.
const RESIDENT_BOARDS = new Set(['issues', 'settings'])
export const tabRoute = (route) => RESIDENT_BOARDS.has(route?.page)
  ? { ...route, param: null, query: null }
  : (route?.page === 'spec' && route?.param) || (route?.page === 'sessions' && route?.param && !isResourceRoute(route))
    ? { ...route, query: null }
    : route
export const tabKey = (t) => {
  const route = tabRoute(t)
  return routeHash(route.page, route.param, route.query)
}

// EVERY TAB IS ONE SHAPE: an address. Older releases persisted `pinned` / `held` / `preview` marks that made
// some tabs immune to ordinary navigation, and a reload resurrected that immunity long after the reader had
// forgotten how the tab arrived. The read boundary drops those marks and collapses duplicate identities, so
// nothing a previous release wrote can still protect a tab. The document predicate is supplied by the view
// registry so persisted routes that no longer belong in the workspace (bare boards, for example) are cleared
// at the same read boundary as new routes.
export function normalizeTabs(raw, isDocument = () => true) {
  const unique = []
  const seen = new Set()
  for (const t of raw) {
    if (!isDocument(t.page, t.param ?? null)) continue
    const tab = { page: t.page, param: t.param ?? null, query: t.query ?? null }
    if (tab.page === 'sessions' && tab.param && tab.param !== 'new' && typeof t.title === 'string' && t.title.trim()) {
      tab.title = t.title
    }
    const key = tabKey(tab)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(tab)
  }
  return unique
}

// WHERE THE STRIP LANDS, given what it holds and what was asked for. An already-open address is activated
// (its detail or face updated in place). A new address REPLACES the focused tab when that tab is of the same
// kind (`activeKey` names it); otherwise it is APPENDED — because another kind is focused, because nothing in
// the strip is focused yet (a cold deep link, a non-document route), or because the caller asked for
// `append` (ctrl/⌘-click, "open in a new tab", session creation). No tab is immune: a tab that arrived by
// append is replaced by the next plain same-kind navigation exactly like one that arrived by a plain click.
export function placeTab(tabs, route, mode = 'slot', activeKey = null) {
  const original = { page: route.page, param: route.param ?? null, query: route.query ?? null }
  const normalized = tabRoute(original)
  const key = tabKey(normalized)
  const open = tabs.find((t) => tabKey(t) === key)
  if (open) {
    // The address matched a tab that is already open, so nothing is placed. If it differs at all, it differs
    // only in a part the identity DROPPED — a session face, a board's detail selector — and that tab takes
    // the new address where it sits: the same document, seen through a different selector.
    const sameAddress = (open.param ?? null) === original.param
      && JSON.stringify(open.query || null) === JSON.stringify(original.query || null)
    if (sameAddress) return tabs
    return tabs.map((t) => (tabKey(t) === key ? { ...t, param: original.param, query: original.query } : t))
  }
  const entry = { page: original.page, param: original.param, query: original.query }
  const slot = mode === 'append' || activeKey == null ? -1
    : tabs.findIndex((t) => tabKey(t) === activeKey && tabKind(t) === tabKind(normalized))
  if (slot < 0) return [...tabs, entry]
  return tabs.map((t, i) => (i === slot ? entry : t))
}

// REORDERING IS A SPLICE. The strip's order IS this array's order, so a dragged tab is one entry taken out
// and put back at one index — there is no drag state machine here, and nothing about a tab changes except
// where it sits. `before` names the tab the moved one lands in FRONT of; null means the end of the strip,
// which is the one insertion point no existing tab can name.
//
// An order that did not change returns the SAME array, so a drag that lands where it started writes
// nothing and wakes no subscriber.
export function moveTab(tabs, key, before = null) {
  const from = tabs.findIndex((t) => tabKey(t) === key)
  if (from < 0) return tabs
  const rest = tabs.filter((_, i) => i !== from)
  const to = before == null ? rest.length : rest.findIndex((t) => tabKey(t) === before)
  if (to < 0 || to === from) return tabs
  return [...rest.slice(0, to), tabs[from], ...rest.slice(to)]
}

// Positional focus is one-based for the desktop chord family. Digit 9 follows the browser/Obsidian
// convention and selects the last tab, while positions beyond the current strip are inert.
export function focusTab(tabs, ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 9 || !tabs.length) return null
  return tabs[ordinal === 9 ? tabs.length - 1 : ordinal - 1] || null
}

// WHERE CLOSING LANDS — one selector, no per-kind branches while tabs remain. `recent` is the strip's focus
// history, most recent first, as tab keys. A surviving tab in that history inherits regardless of kind — the
// reader is returned to the document they actually came from, so a Spec tab beats an unrelated session file
// when a file opened from Spec is closed. With no focused survivor, position remains deterministic: the nearest
// same-kind tab wins, right beating left at a tie, then the nearest tab of any kind. Only an emptied strip
// returns an explicit no-tab destination. A published resource has one additional owner contract: when its
// session tab survives, closing the resource returns to that session before applying the general rule.
export function closeDestination(tab, remaining, index, recent = []) {
  const kind = tabKind(tabRoute(tab))
  if (isResourceRoute(tab)) {
    const owner = remaining.find((candidate) => candidate.page === 'sessions'
      && candidate.param === tab.param && !isResourceRoute(candidate))
    if (owner) return owner
  }
  const latest = (match) => {
    for (const key of recent) {
      const hit = remaining.find((t) => tabKey(t) === key)
      if (hit && match(hit)) return hit
    }
    return null
  }
  const nearest = (match) => {
    for (let step = 0; step < remaining.length; step += 1) {
      const right = remaining[index + step]
      if (right && match(right)) return right
      const left = remaining[index - 1 - step]
      if (left && match(left)) return left
    }
    return null
  }
  const anyKind = () => true
  const sameKind = (t) => tabKind(t) === kind
  const heir = latest(anyKind) || nearest(sameKind) || nearest(anyKind)
  if (heir) return heir
  if (isResourceRoute(tab)) return { page: 'sessions', param: 'new', query: null }
  if (tab?.page === 'spec' || tab?.page === 'file') return { page: 'graph', param: null, query: null }
  return { page: 'empty', param: null, query: null }
}

// ---------------------------------------------------------------------------------------------------
// THE WORKSPACE IS A TREE OF GROUPS ([[tab-strip]]). One group is the ordinary case and behaves exactly as
// one strip always did; splitting one makes a pair, and splitting again makes a grid. The tree is two shapes:
//
//   · a GROUP (leaf): `{ id, tabs, active }` — its own working set and its own active tab. Its band is a
//     tab strip, so a document moved into it lands in a list the reader can grow, not in a fixed slot.
//   · a SPLIT (node): `{ id, dir, ratio, children: [a, b] }` — two subtrees beside (`row`) or above/below
//     (`col`) each other, sharing the space at `ratio`.
//
// A document lives in exactly ONE group: every move here takes it out of the group it was in. That is the
// invariant the whole model exists to keep, and the reason splitting is a move rather than a copy.

let mint = 0
export const groupId = () => `g${(mint += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`
export const isGroup = (node) => !!node && Array.isArray(node.tabs)
export const groupsOf = (node) => (isGroup(node) ? [node] : node ? node.children.flatMap(groupsOf) : [])
export const groupOf = (root, id) => groupsOf(root).find((group) => group.id === id) || null
// which group holds an address, so an address open elsewhere is FOCUSED rather than opened twice
export const groupHolding = (root, key) => groupsOf(root).find((group) => group.tabs.some((tab) => tabKey(tab) === key)) || null

// Structural edits are pure rewrites of the path to the node that changed; every other subtree keeps its
// identity, so React keeps every untouched document mounted.
const rewrite = (node, id, fn) => {
  if (!node) return node
  if (node.id === id) return fn(node)
  if (isGroup(node)) return node
  const children = node.children.map((child) => rewrite(child, id, fn))
  return children[0] === node.children[0] && children[1] === node.children[1] ? node : { ...node, children }
}
// A group that lost its last tab is not a place: its parent split collapses into the surviving sibling.
const prune = (node) => {
  if (!node || isGroup(node)) return node?.tabs?.length ? node : null
  const children = node.children.map(prune).filter(Boolean)
  if (!children.length) return null
  if (children.length === 1) return children[0]
  return children[0] === node.children[0] && children[1] === node.children[1] ? node : { ...node, children }
}

export function updateGroup(root, id, fn) {
  const next = rewrite(root, id, (group) => (isGroup(group) ? fn(group) : group))
  return prune(next)
}

// SPLITTING IS A MOVE. The tab leaves its group for a new sibling one, so the pair shows two documents
// rather than one document twice. A group's only tab cannot be split off: the source would vanish and the
// split would collapse in the same gesture, so the caller shows the verb as unavailable instead.
export function splitGroup(root, id, key, dir, makeId = groupId) {
  const source = groupOf(root, id)
  if (!source || source.tabs.length < 2) return null
  const moving = source.tabs.find((tab) => tabKey(tab) === key)
  if (!moving) return null
  const rest = source.tabs.filter((tab) => tabKey(tab) !== key)
  const opened = { id: makeId(), tabs: [moving], active: key }
  const next = rewrite(root, id, (group) => ({
    id: makeId(), dir, ratio: 0.5,
    children: [
      { ...group, tabs: rest, active: rest.some((tab) => tabKey(tab) === group.active) ? group.active : tabKey(rest[rest.length - 1]) },
      opened,
    ],
  }))
  return { root: next, focus: opened.id }
}

// MOVING A TAB BETWEEN GROUPS is the same move without the new place: it leaves one list and lands in
// another, at the position the pointer named (`before` = the tab it lands in front of; null = the end).
// Dropping the last tab out of a group collapses that group, so a drag can rearrange the grid too.
export function moveTabToGroup(root, key, targetId, before = null) {
  const source = groupHolding(root, key)
  const target = groupOf(root, targetId)
  if (!source || !target) return null
  const moving = source.tabs.find((tab) => tabKey(tab) === key)
  if (source.id === targetId) {
    const reordered = moveTab(source.tabs, key, before)
    return reordered === source.tabs ? null : { root: updateGroup(root, targetId, (group) => ({ ...group, tabs: reordered })), focus: targetId }
  }
  const withoutSource = updateGroup(root, source.id, (group) => {
    const tabs = group.tabs.filter((tab) => tabKey(tab) !== key)
    return { ...group, tabs, active: tabs.some((t) => tabKey(t) === group.active) ? group.active : tabKey(tabs[tabs.length - 1] || {}) || null }
  })
  const next = updateGroup(withoutSource, targetId, (group) => {
    const at = before ? group.tabs.findIndex((tab) => tabKey(tab) === before) : -1
    const tabs = at < 0 ? [...group.tabs, moving] : [...group.tabs.slice(0, at), moving, ...group.tabs.slice(at)]
    return { ...group, tabs, active: key }
  })
  return { root: next, focus: targetId }
}

// The reader's own arrangement: a divider names the split it drags and the share the first child keeps.
export function resizeSplit(root, id, ratio) {
  const clamped = Math.max(0.15, Math.min(0.85, ratio))
  return rewrite(root, id, (node) => (isGroup(node) ? node : { ...node, ratio: clamped }))
}

// THE READ BOUNDARY for the whole workspace, in one place: an older release's flat list, its held slot, and
// anything a second window wrote all arrive here and leave as one valid tree — every group non-empty, every
// active tab present, one focused group that exists, and no document in two groups at once.
export function normalizeLayout(raw, isDocument = () => true, makeId = groupId) {
  const seen = new Set()
  const group = (node) => {
    const tabs = normalizeTabs(Array.isArray(node?.tabs) ? node.tabs : [], isDocument).filter((tab) => {
      const key = tabKey(tab)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!tabs.length) return null
    const active = tabs.some((tab) => tabKey(tab) === node?.active) ? node.active : tabKey(tabs[tabs.length - 1])
    return { id: typeof node?.id === 'string' && node.id ? node.id : makeId(), tabs, active }
  }
  const walk = (node) => {
    if (!node) return null
    // an older release persisted the working set as a bare list; that IS one group's tabs
    if (Array.isArray(node)) return group({ tabs: node })
    if (Array.isArray(node.tabs)) return group(node)
    if (!Array.isArray(node.children)) return null
    const children = node.children.map(walk).filter(Boolean)
    if (!children.length) return null
    if (children.length === 1) return children[0]
    const ratio = Number.isFinite(node.ratio) ? Math.max(0.15, Math.min(0.85, node.ratio)) : 0.5
    return { id: typeof node?.id === 'string' && node.id ? node.id : makeId(), dir: node.dir === 'col' ? 'col' : 'row', ratio, children: children.slice(0, 2) }
  }
  // A WORKSPACE HOLDING NOTHING IS NO TREE AT ALL — not a group with no tabs. A group is a place a document
  // is; an empty one is a region the frame would have to draw around nothing.
  const root = walk(raw?.root ?? raw) || null
  const groups = groupsOf(root)
  const focus = groups.some((g) => g.id === raw?.focus) ? raw.focus : groups[0]?.id || null
  return { root, focus }
}
