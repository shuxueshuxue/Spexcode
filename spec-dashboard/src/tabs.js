import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate, routeHash, useRoute } from './route.js'
import { isDocument } from './views.jsx'

// [[tab-strip]]: a tab IS a route, so opening several is the address grammar in the plural — not a second
// navigation model laid beside it.
//
// LOOKING IS NOT HOLDING. The strip is the working set — every resident document stays at its address —
// and browsing has one bounded exception: spec/file documents may occupy the single preview slot. A new
// preview replaces only the old preview; it never replaces a resident tab. Holding is the explicit gesture:
// ctrl/⌘-click (or a document's own promotion path) opens a resident tab.
//
// The split of truth is deliberate and follows what every workspace editor settled on: the OPEN LIST is a
// local layout preference (it survives reloads, it is not worth putting in a link, and two people opening
// the same link should not inherit each other's tabs), while the ACTIVE tab is the URL. That keeps every
// address still copyable, bookmarkable and Back-navigable exactly as before — a reader who has never
// opened a second tab cannot tell this landed.

const KEY = 'spexcode.tabs'
const PREVIEW_PAGES = new Set(['spec', 'file'])
const isPreviewable = (page) => PREVIEW_PAGES.has(page)

// A tab's identity is its canonical hash. Two routes that print the same address ARE the same tab, so
// nothing has to dedupe by hand and a re-open of an already-open document activates it instead of stacking.
export const tabKey = (t) => routeHash(t.page, t.param, t.query)

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw)
      ? raw.filter((t) => t && typeof t.page === 'string' && isDocument(t.page, t.param))
        // Legacy entries had no preview contract. Treat entries without the new marker as resident;
        // current preview entries survive reload as the one bounded preview slot.
        .map((t) => ({ page: t.page, param: t.param ?? null, query: t.query ?? null,
          preview: t.preview === true && isPreviewable(t.page) }))
      : []
  } catch { return [] }
}
const write = (tabs) => { try { localStorage.setItem(KEY, JSON.stringify(tabs)) } catch { /* private mode */ } }

// Which routes are worth a tab is the VIEW REGISTRY's answer, not a second list here. It was a second list
// for one commit, and in that commit the strip could not hold the document addresses the registry had
// already declared — two sources of truth disagreeing exactly where they were supposed to agree.

// A finding surface cannot reach the strip's state directly: it marks the NEXT navigation, and the strip's
// route subscription consumes the mark. The mode is intentionally one shared latch so promotion and preview
// opening cannot drift into separate tab policies.
let nextMode = 'resident'
let nextModeKey = null
let tabCommands = null
export function registerTabCommands(commands) {
  tabCommands = commands
  return () => { if (tabCommands === commands) tabCommands = null }
}
export function runTabCommand(name, ...args) {
  return tabCommands?.[name]?.(...args)
}
export function requestTab(page, param = null, query = null) {
  nextMode = 'resident'
  nextModeKey = routeHash(page, param, query)
  if (window.location.hash === nextModeKey) {
    tabCommands?.promoteActive?.()
    nextModeKey = null
    return
  }
  navigate(page, param, { query })
}
export function previewTab(page, param = null, query = null) {
  nextMode = isPreviewable(page) ? 'preview' : 'resident'
  nextModeKey = routeHash(page, param, query)
  if (window.location.hash === nextModeKey) {
    nextModeKey = null
    return
  }
  navigate(page, param, { query })
}

export function useTabs() {
  const route = useRoute()
  const [tabs, setTabs] = useState(read)

  // The current address is always present in the strip. A new resident appends; a preview replaces only the
  // existing preview. If navigation leaves a preview document for another document, the old preview is
  // promoted first: opening something from a preview is an explicit decision to keep what was being read.
  // Resident tabs are never truncated; a capacity bound must not become a hidden address replacement.
  // The whole decision lives here, so finding surfaces do not grow their own tab semantics.
  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const prevKeyRef = useRef(null)
  useEffect(() => {
    if (!isDocument(route.page, route.param)) return
    const key = routeHash(route.page, route.param, route.query)
    const mode = nextModeKey === key ? nextMode : 'resident'
    if (nextModeKey && nextModeKey !== key) { nextMode = 'resident'; nextModeKey = null }
    if (nextModeKey === key) { nextMode = 'resident'; nextModeKey = null }
    const prev = tabsRef.current
    const before = prevKeyRef.current
    prevKeyRef.current = key
    const existing = prev.find((t) => tabKey(t) === key)
    const current = prev.find((t) => tabKey(t) === before)
    if (existing) {
      const promoteCurrent = current?.preview && before !== key
      const promoteExisting = mode === 'resident' && existing.preview
      if (promoteCurrent || promoteExisting) {
        const next = prev.map((t) => (tabKey(t) === before || (promoteExisting && tabKey(t) === key))
          ? { ...t, preview: false } : t)
        write(next); setTabs(next)
      }
      return
    }
    const tab = { page: route.page, param: route.param, query: route.query, preview: mode === 'preview' && isPreviewable(route.page) }
    let next = prev
    if (tab.preview) {
      next = prev.filter((t) => !t.preview)
    } else if (current?.preview) {
      next = prev.map((t) => tabKey(t) === before ? { ...t, preview: false } : t)
    }
    next = [...next, tab]
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

  useEffect(() => registerTabCommands({
    promoteActive: () => {
      const active = tabs.find((tab) => tabKey(tab) === activeKey)
      if (!active?.preview) return
      const next = tabs.map((tab) => tab === active ? { ...tab, preview: false } : tab)
      write(next); setTabs(next)
    },
    closeActive: () => {
      const active = tabs.find((tab) => tabKey(tab) === activeKey)
      if (active) close(active)
    },
    move: (dir) => {
      const index = tabs.findIndex((tab) => tabKey(tab) === activeKey)
      if (index < 0 || tabs.length < 2) return
      const next = tabs[(index + dir + tabs.length) % tabs.length]
      open(next)
    },
    active: () => tabs.find((tab) => tabKey(tab) === activeKey) || null,
  }), [tabs, activeKey, open, close])

  return useMemo(() => ({ tabs, activeKey, open, close, closeOthers }), [tabs, activeKey, open, close, closeOthers])
}
