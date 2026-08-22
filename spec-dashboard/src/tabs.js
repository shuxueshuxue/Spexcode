import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate, routeHash, useRoute } from './route.js'

// [[tab-strip]]: a tab IS a route, so opening several is the address grammar in the plural — not a second
// navigation model laid beside it.
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

// Which routes are worth a tab. `settings` is a modal-shaped destination people bounce off, not a document
// they keep open, so it is navigable but never accumulates — the strip would otherwise fill with visits.
const TABBABLE = new Set(['graph', 'sessions', 'evals', 'issues'])

export function useTabs() {
  const route = useRoute()
  const [tabs, setTabs] = useState(read)

  // The current address is always present in the strip: navigating anywhere — a link, a keyboard jump, a
  // click on the board — opens a tab, because otherwise the strip would claim to show what is open while
  // the reader looked at something absent from it.
  useEffect(() => {
    if (!TABBABLE.has(route.page)) return
    const key = routeHash(route.page, route.param, route.query)
    setTabs((prev) => {
      if (prev.some((t) => tabKey(t) === key)) return prev
      const next = [...prev, { page: route.page, param: route.param, query: route.query }].slice(-MAX)
      write(next)
      return next
    })
  }, [route.page, route.param, route.query])

  const activeKey = routeHash(route.page, route.param, route.query)

  const open = useCallback((tab) => navigate(tab.page, tab.param, { query: tab.query }), [])

  // Closing the ACTIVE tab hands focus to its right-hand neighbour, else its left — the rule every editor
  // uses, because the reader's eye is already where the closed tab was. Closing the last one falls back to
  // the board rather than leaving an empty frame.
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
        else navigate('graph')
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
