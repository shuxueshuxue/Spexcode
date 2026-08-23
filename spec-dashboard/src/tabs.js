import { useCallback, useEffect, useMemo, useState } from 'react'
import { navigate, parseRoute, useRoute } from './route.js'
import { isDocument } from './views.jsx'
import { closeDestination, moveTab, normalizeTabs, placeTab, tabKey } from './tabModel.js'

export { closeDestination, moveTab, placeTab, tabKey }

// [[tab-strip]]: a tab IS a route, so opening several is the address grammar in the plural — not a second
// navigation model laid beside it.
//
// A NEW TAB IS A GESTURE, NEVER A SIDE EFFECT. The strip holds the documents the reader asked it to hold,
// plus one current slot per document kind that ordinary navigation lands in and reuses. Every plain click —
// an explorer row, a dock session row, an object row, a link inside a document — replaces the same-kind slot;
// an address of another kind gets its own slot rather than evicting a different kind. Holding is explicit:
// ctrl/⌘-click, a double-click, or a document's own "open in a new tab" action. That is the whole rule, and
// it keeps the old anti-proliferation guarantee without allowing cross-kind eviction.
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
    return Array.isArray(raw) ? normalizeTabs(raw.filter((t) => t && typeof t.page === 'string'), isDocument) : []
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
  const key = tabKey({ page, param, query })
  pinKey = key
  const held = getTabs()
  if (held.some((tab) => tabKey(tab) === key)) {
    putTabs(held.map((tab) => (tabKey(tab) === key ? { ...tab, pinned: true } : tab)))
    pinKey = null
  }
  navigate(page, param, { query })
}

// The route an in-app hash href names, as `pinTab` wants it. A row that is a REAL anchor already holds its
// address; nothing has to re-derive it from the data the row was built from.
export const routeOfHash = (href) => {
  const { page, param, query } = parseRoute(href)
  return { page, param, query: Object.keys(query || {}).length ? query : null }
}

// THE ROW GESTURE, for every finding surface whose rows are real anchors — the review lists, the spec
// context panels, the file tree. A plain click stays the anchor's: the browser writes the hash and the slot
// takes it, which is the default this workspace is built on. Ctrl/⌘ is the WORKSPACE's hold rather than the
// browser's new-window, because the reader asking for a second document beside the one they have is asking
// for a second tab in the strip, not a second copy of the app. Shift, alt and middle-click are left alone,
// so every window-level gesture a real anchor gives for free still works. Returns whether it took the event.
export function holdAnchor(event, href) {
  if (event.button !== 0 || event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey)) return false
  event.preventDefault()
  const route = routeOfHash(href)
  pinTab(route.page, route.param, route.query)
  return true
}

// Focus the most recently opened tab a predicate accepts, if there is one. The rail's sessions button is
// the caller: asking for sessions when a session is already held should return the reader to it rather
// than to a launch page they did not ask for. Returns whether anything was focused.
export function focusLatestTab(match) {
  const held = getTabs().filter(match)
  const last = held[held.length - 1]
  if (!last) return false
  navigate(last.page, last.param, { query: last.query })
  return true
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
    const key = tabKey(route)
    if (pinKey && pinKey !== key) pinKey = null
    if (!isDocument(route.page, route.param)) return
    const mode = pinKey === key ? 'pin' : 'slot'
    putTabs(placeTab(getTabs(), route, mode))
  }, [route.page, route.param, route.query])

  const activeKey = tabKey(route)

  const open = useCallback((tab) => navigate(tab.page, tab.param, { query: tab.query }), [])

  // Closing stays in the tab's identity domain: session tabs prefer the right session, then the left, and
  // only an empty session set lands on New Session. Spec/file tabs retain their graph-bottom-sheet return.
  const close = useCallback((tab) => {
    const key = tabKey(tab)
    const prev = getTabs()
    const i = prev.findIndex((t) => tabKey(t) === key)
    if (i < 0) return
    const next = prev.filter((_, n) => n !== i)
    putTabs(next)
    if (key === activeKey) {
      const destination = closeDestination(tab, next, i)
      navigate(destination.page, destination.param, { query: destination.query })
    }
  }, [activeKey])

  const closeOthers = useCallback((tab) => {
    const key = tabKey(tab)
    putTabs(getTabs().filter((t) => tabKey(t) === key))
    if (key !== activeKey) navigate(tab.page, tab.param, { query: tab.query })
  }, [activeKey])

  // THE READER'S OWN ORDER. The strip already persists its list; reordering it is the same write, so the
  // arrangement survives a reload for free and needs no second store. Nothing here navigates — a drag says
  // where a document sits, never which one you are looking at.
  const move = useCallback((key, before) => { putTabs(moveTab(getTabs(), key, before)) }, [])

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

  return useMemo(() => ({ tabs, activeKey, open, close, closeOthers, move }), [tabs, activeKey, open, close, closeOthers, move])
}
