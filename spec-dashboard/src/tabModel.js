import { routeHash } from './route.js'

// [[tab-strip]]'s semantics, as pure functions — no React, no view registry, no storage. The strip's one
// law ("a new tab is a gesture, never a side effect") is a property of these two functions, so it can be
// checked without a browser. It is here rather than in `tabs.js` for exactly that reason: the hook needs
// the view registry, the registry is JSX, and a rule nobody can test in isolation is a rule that drifts.

// A tab's identity is its canonical hash. Two routes that print the same address ARE the same tab, so
// nothing has to dedupe by hand and a re-open of an already-open document activates it instead of stacking.
export const tabKey = (t) => routeHash(t.page, t.param, t.query)

// At most ONE tab is unpinned — the current slot. Legacy entries carried a `preview` marker with a
// narrower meaning (spec/file documents only); a legacy preview becomes the slot and every other entry is
// pinned, because those tabs were minted under rules that kept them.
//
// `resident(page, param)` is [[view-registry]]'s residency answer, passed in rather than imported: the
// registry is JSX and this module is the part that must stay checkable without a browser. A stored slot
// entry for a resident address is promoted here, so a store written before residency existed — or edited by
// hand — cannot hand the boot a singleton board sitting in the slot.
export function normalizeTabs(raw, resident = () => false) {
  const tabs = raw.map((t) => ({
    page: t.page, param: t.param ?? null, query: t.query ?? null,
    pinned: (t.pinned != null ? t.pinned !== false : t.preview !== true) || resident(t.page, t.param ?? null),
  }))
  const slot = tabs.map((t) => t.pinned).lastIndexOf(false)
  return tabs.map((t, i) => (t.pinned || i === slot ? t : { ...t, pinned: true }))
}

// WHERE THE STRIP LANDS, given what it holds and what was asked for. Everything the strip decides is here:
// an already-open address is activated (and pinned when that is what was asked); a new one takes the slot
// IN PLACE — keeping the slot's position, so the strip does not reshuffle under the reader — or is
// appended when it is pinned, or when there is no slot yet.
export function placeTab(tabs, route, mode = 'slot') {
  const key = routeHash(route.page, route.param, route.query)
  const open = tabs.find((t) => tabKey(t) === key)
  if (open) {
    if (mode !== 'pin' || open.pinned) return tabs
    return tabs.map((t) => (tabKey(t) === key ? { ...t, pinned: true } : t))
  }
  const entry = { page: route.page, param: route.param ?? null, query: route.query ?? null, pinned: mode === 'pin' }
  const slot = tabs.findIndex((t) => !t.pinned)
  if (mode === 'pin' || slot < 0) return [...tabs, entry]
  return tabs.map((t, i) => (i === slot ? entry : t))
}
