import { routeHash } from './route.js'

// [[tab-strip]]'s semantics, as pure functions — no React, no view registry, no storage. The strip's one
// law ("a new tab is a gesture, never a side effect") is a property of these two functions, so it can be
// checked without a browser. It is here rather than in `tabs.js` for exactly that reason: the hook needs
// the view registry, the registry is JSX, and a rule nobody can test in isolation is a rule that drifts.

// A tab's identity is the object address. Base session faces are selectors on that object, not different
// documents: changing `?surface=conversation|terminal|diff` must update the URL without replacing or
// multiplying the session tab. Published resources are the exception: they are file-class workspace objects,
// so their resource selector remains in the identity and opens beside the session.
export const isResourceRoute = (route) => route?.page === 'sessions' && typeof route?.query?.surface === 'string'
  && route.query.surface.startsWith('resource:')
export const tabKind = (route) => isResourceRoute(route) ? 'file' : route?.page
export const tabRoute = (route) => route?.page === 'sessions' && route?.param && !isResourceRoute(route)
  ? { ...route, query: null }
  : route
export const tabKey = (t) => {
  const route = tabRoute(t)
  return routeHash(route.page, route.param, route.query)
}

// At most ONE tab per page kind is unpinned — the current slot for that kind. Legacy entries carried a
// `preview` marker with a narrower meaning (spec/file documents only); a legacy preview becomes the slot
// for its kind and every other entry is pinned, because those tabs were minted under rules that kept them.
// The document predicate is supplied by the view registry so persisted routes that no longer belong in the
// workspace (bare boards, for example) are cleared at the same read boundary as new routes.
export function normalizeTabs(raw, isDocument = () => true) {
  const tabs = raw.filter((t) => isDocument(t.page, t.param ?? null)).map((t) => {
    const route = { page: t.page, param: t.param ?? null, query: t.query ?? null }
    return {
      page: route.page, param: route.param ?? null, query: route.query ?? null,
      // Published resources are deliberate holds: they must never compete for a replaceable file slot,
      // including when an older persisted record forgot to mark them pinned.
      pinned: isResourceRoute(route) ? true : (t.pinned != null ? t.pinned !== false : t.preview !== true),
    }
  })
  const unique = []
  const byKey = new Map()
  for (const tab of tabs) {
    const key = tabKey(tab)
    const existing = byKey.get(key)
    if (existing) { existing.pinned ||= tab.pinned; continue }
    byKey.set(key, tab)
    unique.push(tab)
  }
  const slots = new Map()
  unique.forEach((t, i) => { if (!t.pinned) slots.set(tabKind(t), i) })
  return unique.map((t, i) => (t.pinned || slots.get(tabKind(t)) === i ? t : { ...t, pinned: true }))
}

// WHERE THE STRIP LANDS, given what it holds and what was asked for. Everything the strip decides is here:
// an already-open address is activated (and pinned when that is what was asked); a new one takes its kind's
// slot IN PLACE — keeping that slot's position, so the strip does not reshuffle under the reader — or is
// appended when it is pinned, or when there is no slot for that kind yet.
export function placeTab(tabs, route, mode = 'slot') {
  const normalized = { page: route.page, param: route.param ?? null, query: route.query ?? null }
  const key = tabKey(normalized)
  const open = tabs.find((t) => tabKey(t) === key)
  if (open) {
    const faceChanged = normalized.page === 'sessions' && !isResourceRoute(normalized)
      && JSON.stringify(open.query || null) !== JSON.stringify(normalized.query || null)
    if (mode !== 'pin' && !faceChanged) return tabs
    return tabs.map((t) => tabKey(t) === key
      ? { ...t, ...(faceChanged ? { query: normalized.query } : {}), ...(mode === 'pin' ? { pinned: true } : {}) }
      : t)
  }
  const entry = {
    page: normalized.page,
    param: normalized.param ?? null,
    query: normalized.query ?? null,
    // A resource opened from a session is a held file-class object. It is intentionally durable until
    // explicitly closed, so ordinary file navigation can never evict it.
    pinned: isResourceRoute(normalized) || mode === 'pin',
  }
  // A published resource is a file-class workspace tab. Opening one appends it, preserving the session tab
  // and its selected base face; a second click on the same resource was handled by the identity check above.
  if (isResourceRoute(normalized)) return [...tabs, entry]
  const slot = tabs.findIndex((t) => !t.pinned && tabKind(t) === tabKind(normalized))
  if (mode === 'pin' || slot < 0) return [...tabs, entry]
  return tabs.map((t, i) => (i === slot ? entry : t))
}

// REORDERING IS A SPLICE. The strip's order IS this array's order, so a dragged tab is one entry taken out
// and put back at one index — there is no drag state machine here, and nothing about a tab changes except
// where it sits. `before` names the tab the moved one lands in FRONT of; null means the end of the strip,
// which is the one insertion point no existing tab can name.
//
// A slot is not special. It is an ordinary entry that happens to be unpinned, and `placeTab` finds the
// requested kind's slot by that flag rather than by position, so a reader may drag it anywhere without
// changing what it means.
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

const isSessionTab = (tab) => tab?.page === 'sessions' && tab.param != null && tab.param !== 'new' && !isResourceRoute(tab)
export function closeDestination(tab, remaining, index) {
  if (isResourceRoute(tab)) {
    const session = remaining.slice(index).find(isSessionTab) || [...remaining.slice(0, index)].reverse().find(isSessionTab)
    return session || { page: 'sessions', param: 'new', query: null }
  }
  if (isSessionTab(tab)) {
    const right = remaining.slice(index).find(isSessionTab)
    const left = [...remaining.slice(0, index)].reverse().find(isSessionTab)
    return right || left || { page: 'sessions', param: 'new', query: null }
  }
  if (tab?.page === 'spec' || tab?.page === 'file') return { page: 'graph', param: null, query: null }
  const heir = remaining[index] || remaining[index - 1]
  return heir || { page: 'empty', param: null, query: null }
}
