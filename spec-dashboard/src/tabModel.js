import { routeHash } from './route.js'

// [[tab-strip]]'s semantics, as pure functions — no React, no view registry, no storage. The strip's one
// law ("a new tab is a gesture, never a side effect") is a property of these two functions, so it can be
// checked without a browser. It is here rather than in `tabs.js` for exactly that reason: the hook needs
// the view registry, the registry is JSX, and a rule nobody can test in isolation is a rule that drifts.

// A tab's identity is the object address unless the view is resident. Base session faces are selectors on
// that object, not different documents: changing `?surface=conversation|terminal|diff` must update the URL
// without replacing or multiplying the session tab. Resident Spec/Evals/Issues/Settings details canonicalize
// to their top-level address. Published resources are the exception: they are file-class workspace objects,
// so their resource selector remains in the identity — a resource and its session are two tabs, not two faces.
export const isResourceRoute = (route) => route?.page === 'sessions' && typeof route?.query?.surface === 'string'
  && route.query.surface.startsWith('resource:')
export const tabKind = (route) => isResourceRoute(route) ? 'file' : route?.page
// Board details share one top-level identity, but that identity is still a normal workspace tab. The view
// registry's `resident` flag describes URL canonicalization; it does not seed or pin the tab.
const TOP_LEVEL_PAGES = new Set(['spec', 'evals', 'issues', 'settings'])
export const tabRoute = (route) => route?.page === 'sessions' && route?.param && !isResourceRoute(route)
  ? { ...route, query: null }
  : TOP_LEVEL_PAGES.has(route?.page)
    ? { ...route, param: null, query: null }
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
    const faceChanged = normalized.page === 'sessions' && !isResourceRoute(normalized)
      && JSON.stringify(open.query || null) !== JSON.stringify(normalized.query || null)
    const residentChanged = TOP_LEVEL_PAGES.has(normalized.page)
      && (open.param !== original.param || JSON.stringify(open.query || null) !== JSON.stringify(original.query || null))
    if (!faceChanged && !residentChanged) return tabs
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
