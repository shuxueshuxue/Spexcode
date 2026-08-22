import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate, routeHash, useRoute } from './route.js'
import { isDocument } from './views.jsx'
import { normalizeTabs, placeTab, tabKey } from './tabModel.js'

export { placeTab, tabKey }

// [[tab-strip]]: a tab IS a route, so opening several is the address grammar in the plural — not a second
// navigation model laid beside it.
//
// A NEW TAB IS A GESTURE, NEVER A SIDE EFFECT. The strip holds the documents the reader asked it to hold,
// plus ONE current slot that ordinary navigation lands in and reuses. Every plain click — an explorer row,
// a dock session row, a board row, a link inside a document — replaces the slot's address; it never grows
// the strip. Holding is explicit: ctrl/⌘-click, a double-click, or a document's own "open in a new tab"
// action. That is the whole rule, and it is deliberately independent of WHAT is being opened: the old
// version fenced replacement to spec/file documents by type, which meant browsing sessions or board rows
// minted a tab per click and the strip filled with things nobody had decided to keep.
//
// The split of truth is deliberate and follows what every workspace editor settled on: the OPEN LIST is a
// local layout preference (it survives reloads, it is not worth putting in a link, and two people opening
// the same link should not inherit each other's tabs), while the ACTIVE tab is the URL. That keeps every
// address still copyable, bookmarkable and Back-navigable exactly as before — a reader who has never
// opened a second tab cannot tell this landed.

const KEY = 'spexcode.tabs'

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? normalizeTabs(raw.filter((t) => t && typeof t.page === 'string' && isDocument(t.page, t.param))) : []
  } catch { return [] }
}
const write = (tabs) => { try { localStorage.setItem(KEY, JSON.stringify(tabs)) } catch { /* private mode */ } }

// Which routes are worth a tab is the VIEW REGISTRY's answer, not a second list here. It was a second list
// for one commit, and in that commit the strip could not hold the document addresses the registry had
// already declared — two sources of truth disagreeing exactly where they were supposed to agree.

// ONE working set, however many components read it. `useTabs` has more than one caller — the strip draws
// it, the session console reads it to know which resource previews are still open — and per-component
// state made those callers two copies of the same list that could disagree: a command routed through the
// module (⌥⇧X, a double-click promotion) updated whichever copy had registered last, and the strip kept
// drawing the other. The store is the list; every caller subscribes to it.
let store = null
const listeners = new Set()
const getTabs = () => (store ??= read())
const putTabs = (next) => {
  if (next === getTabs()) return next
  store = next
  write(next)
  for (const listener of [...listeners]) listener(next)
  return next
}

// A finding surface cannot reach the strip's state directly: an explicit hold MARKS the next navigation and
// the strip's route subscription reads the mark. The mark is an address, not a flag, so two subscribers
// (the strip and the session console both call useTabs) read the same answer for the same navigation; it
// is dropped when a different address arrives, which is the only way it can go stale.
let pinKey = null
let tabCommands = null
export function registerTabCommands(commands) {
  tabCommands = commands
  return () => { if (tabCommands === commands) tabCommands = null }
}
export function runTabCommand(name, ...args) {
  return tabCommands?.[name]?.(...args)
}
// The explicit hold. Ordinary navigation needs nothing from this module — `navigate` lands in the slot,
// which is what makes "a new tab is a gesture" true by default rather than by discipline at every call site.
//
// It pins the ADDRESS it was given, never "whatever is active". A double-click is two clicks and then the
// dblclick event, and the first click has already navigated — so "active" is a race with React's own
// processing of that navigation, and losing it pinned the document the reader had just left instead of the
// one they were holding. Naming the address removes the race: if the tab is already in the list it is
// pinned here, and if the navigation is still in flight the mark makes the placement itself pinned.
export function pinTab(page, param = null, query = null) {
  const key = routeHash(page, param, query)
  pinKey = key
  const held = getTabs()
  if (held.some((tab) => tabKey(tab) === key)) {
    putTabs(held.map((tab) => (tabKey(tab) === key ? { ...tab, pinned: true } : tab)))
    pinKey = null
  }
  navigate(page, param, { query })
}

export function useTabs() {
  const route = useRoute()
  const [tabs, setTabs] = useState(getTabs)
  useEffect(() => {
    listeners.add(setTabs)
    setTabs(getTabs())
    return () => { listeners.delete(setTabs) }
  }, [])

  // The current address is always present in the strip, because a strip that claimed to show what is open
  // while the reader looked at something absent from it would be lying. Every caller runs this and the
  // second one is a no-op: `placeTab` returns the list unchanged once the address is placed.
  useEffect(() => {
    if (!isDocument(route.page, route.param)) return
    const key = routeHash(route.page, route.param, route.query)
    const mode = pinKey === key ? 'pin' : 'slot'
    if (pinKey && pinKey !== key) pinKey = null
    putTabs(placeTab(getTabs(), route, mode))
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
    const prev = getTabs()
    const i = prev.findIndex((t) => tabKey(t) === key)
    if (i < 0) return
    const next = prev.filter((_, n) => n !== i)
    putTabs(next)
    if (key === activeKey) {
      const heir = next[i] || next[i - 1]
      if (heir) navigate(heir.page, heir.param, { query: heir.query })
      else navigate('empty')
    }
  }, [activeKey])

  const closeOthers = useCallback((tab) => {
    const key = tabKey(tab)
    putTabs(getTabs().filter((t) => tabKey(t) === key))
    if (key !== activeKey) navigate(tab.page, tab.param, { query: tab.query })
  }, [activeKey])

  useEffect(() => registerTabCommands({
    closeActive: () => {
      const active = getTabs().find((tab) => tabKey(tab) === activeKey)
      if (active) close(active)
    },
    move: (dir) => {
      const list = getTabs()
      const index = list.findIndex((tab) => tabKey(tab) === activeKey)
      if (index < 0 || list.length < 2) return
      open(list[(index + dir + list.length) % list.length])
    },
    active: () => getTabs().find((tab) => tabKey(tab) === activeKey) || null,
  }), [activeKey, open, close])

  return useMemo(() => ({ tabs, activeKey, open, close, closeOthers }), [tabs, activeKey, open, close, closeOthers])
}
