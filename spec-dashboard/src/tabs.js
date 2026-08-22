import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate, routeHash, useRoute } from './route.js'
import { isDocument } from './views.jsx'

// [[tab-strip]]: a tab IS a route, so opening several is the address grammar in the plural — not a second
// navigation model laid beside it.
//
// LOOKING IS NOT HOLDING. The strip is the working set — the documents a reader has deliberately kept —
// and browsing must never grow it: a plain navigation (explorer row, board double-click, a link) REPLACES
// the active tab's slot, exactly the way every workspace editor treats an unpinned pane. Holding is the
// explicit gesture: ctrl/⌘-click asks for a NEW tab. Without this boundary every glance became a tab and
// ten minutes of browsing turned the strip into a history list — which is a different, worse widget.
//
// The split of truth is deliberate and follows what every workspace editor settled on: the OPEN LIST is a
// local layout preference (it survives reloads, it is not worth putting in a link, and two people opening
// the same link should not inherit each other's tabs), while the ACTIVE tab is the URL. That keeps every
// address still copyable, bookmarkable and Back-navigable exactly as before — a reader who has never
// opened a second tab cannot tell this landed.

const KEY = 'spexcode.tabs'
const MAX = 24   // a bound, not a policy: past this the strip stops being scannable and starts being a list

// A tab's identity is its canonical hash. Two routes that print the same address ARE the same tab, so
// nothing has to dedupe by hand and a re-open of an already-open document activates it instead of stacking.
export const tabKey = (t) => routeHash(t.page, t.param, t.query)

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((t) => t && typeof t.page === 'string').slice(0, MAX) : []
  } catch { return [] }
}
const write = (tabs) => { try { localStorage.setItem(KEY, JSON.stringify(tabs)) } catch { /* private mode */ } }

// Which routes are worth a tab is the VIEW REGISTRY's answer, not a second list here. It was a second list
// for one commit, and in that commit the strip could not hold the document addresses the registry had
// already declared — two sources of truth disagreeing exactly where they were supposed to agree.

// The one-shot "hold this one" latch. A finding surface (explorer, board) cannot reach the strip's state,
// and should not: it marks the NEXT navigation as a keep, navigates, and the strip's own route subscription
// consumes the mark. Same shape as the workspace's compose handoff — a ref between surfaces that must not
// couple.
let keepNext = false
export function requestTab(page, param = null, query = null) {
  keepNext = true
  navigate(page, param, { query })
}

export function useTabs() {
  const route = useRoute()
  const [tabs, setTabs] = useState(read)

  // The current address is always present in the strip — but a plain navigation REPLACES the slot the
  // reader was in rather than appending, so browsing moves the working set's cursor instead of growing it.
  // Appending happens on exactly two grounds: the reader asked (requestTab's latch), or there is no slot to
  // replace (first document of the session).
  //
  // The whole decision lives in the effect BODY, with the list mirrored in a ref, and setTabs receives a
  // plain value — never an updater. An updater here must be pure, and this decision is not: it consumes the
  // one-shot latch, advances the previous-slot cursor, and persists. StrictMode double-invokes updaters to
  // expose exactly that, and under it the impure version consumed its own cursor and appended instead of
  // replacing.
  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const prevKeyRef = useRef(null)
  useEffect(() => {
    if (!isDocument(route.page)) return
    const key = routeHash(route.page, route.param, route.query)
    const keep = keepNext; keepNext = false
    const prev = tabsRef.current
    const before = prevKeyRef.current
    prevKeyRef.current = key
    if (prev.some((t) => tabKey(t) === key)) return
    const tab = { page: route.page, param: route.param, query: route.query }
    const at = keep ? -1 : prev.findIndex((t) => tabKey(t) === before)
    const next = at < 0 ? [...prev, tab].slice(-MAX) : prev.map((t, i) => (i === at ? tab : t))
    write(next)
    setTabs(next)
  }, [route.page, route.param, route.query])

  const activeKey = routeHash(route.page, route.param, route.query)

  const open = useCallback((tab) => navigate(tab.page, tab.param, { query: tab.query }), [])

  // Closing the ACTIVE tab hands focus to its right-hand neighbour, else its left — the rule every editor
  // uses, because the reader's eye is already where the closed tab was. Closing the LAST one lands on the
  // explicit empty workspace: it used to navigate to the graph, so a gesture that asked for nothing put a
  // document on screen and the board seemed to appear from underneath. An empty working set is a real
  // state, and the reader is owed the state they produced rather than a substitute document.
  const close = useCallback((tab) => {
    const key = tabKey(tab)
    setTabs((prev) => {
      const i = prev.findIndex((t) => tabKey(t) === key)
      if (i < 0) return prev
      const next = prev.filter((_, n) => n !== i)
      write(next)
      if (key === activeKey) {
        const heir = next[i] || next[i - 1]
        if (heir) navigate(heir.page, heir.param, { query: heir.query })
        else navigate('empty')
      }
      return next
    })
  }, [activeKey])

  const closeOthers = useCallback((tab) => {
    const key = tabKey(tab)
    setTabs((prev) => {
      const kept = prev.filter((t) => tabKey(t) === key)
      write(kept)
      return kept
    })
    if (key !== activeKey) navigate(tab.page, tab.param, { query: tab.query })
  }, [activeKey])

  return useMemo(() => ({ tabs, activeKey, open, close, closeOthers }), [tabs, activeKey, open, close, closeOthers])
}
