import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate, parseRoute, useRoute } from './route.js'
import { isDocument } from './views.jsx'
import { closeDestination, moveTab, normalizeTabs, placeTab, tabKey, tabRoute } from './tabModel.js'

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
    if (!Array.isArray(raw)) return []
    const valid = raw
      .filter((t) => t && typeof t.page === 'string')
    const normalized = normalizeTabs(valid, isDocument)
    // Persist the migration at the same boundary that reads it: old review entries disappear once and do
    // not keep resurfacing in another tab or after the next reload.
    if (JSON.stringify(normalized) !== JSON.stringify(valid)) localStorage.setItem(KEY, JSON.stringify(normalized))
    return normalized
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
  const stable = next
  if (stable === getTabs()) return stable
  store = stable
  write(stable)
  for (const listener of [...listeners]) listener(stable)
  return stable
}

// THE STRIP'S FOCUS HISTORY — tab keys, most recent first, in memory only. It is the reader's movement, not
// the working set, so it is session-scoped like the browser's own history rather than persisted with the
// list; until the reader has moved after a reload, `closeDestination` falls back to position. Keys that
// left the strip (a replaced slot, a closed tab) are dropped on the next touch, so the list never outgrows
// the strip.
let recent = []
const touch = (key) => {
  if (recent[0] === key) return
  const held = new Set(getTabs().map(tabKey))
  recent = [key, ...recent.filter((k) => k !== key && held.has(k))]
}
export const recentTabKeys = () => recent

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
// THE HOLD GESTURE, as ONE predicate. Every row surface asks the same question of the same event, so
// "ctrl/⌘-click holds this" cannot mean one thing in the finding dock and another on the Sessions page —
// which is exactly what it meant while each surface hand-rolled its own modifier test. Shift, alt and
// middle-click are deliberately NOT ours: they are the window-level gestures a browser gives a real anchor
// for free, and a reader asking for a second document beside the first is asking this workspace for a tab,
// not the browser for a second copy of the app.
export const isHoldGesture = (event) => event.button === 0 && !event.shiftKey && !event.altKey
  && (event.ctrlKey || event.metaKey)

// The explicit hold, split into its two halves. `markTabHold` records the intent WITHOUT writing the route,
// so a surface whose route writes belong to its own view scope ([[workspace-shell]]) can hold without
// reaching around that boundary; `pinTab` is the mark plus the navigation, for surfaces that own both.
// Ordinary navigation needs neither — `navigate` lands in the slot,
// which is what makes "a new tab is a gesture" true by default rather than by discipline at every call site.
//
// It pins the ADDRESS it was given, never "whatever is active". A double-click is two clicks and then the
// dblclick event, and the first click has already navigated — so "active" is a race with React's own
// processing of that navigation, and losing it pinned the document the reader had just left instead of the
// one they were holding. Naming the address removes the race: if the tab is already in the list it is
// pinned here, and if the navigation is still in flight the mark makes the placement itself pinned.
export function markTabHold(page, param = null, query = null) {
  const key = tabKey(tabRoute({ page, param, query }))
  pinKey = key
  const held = getTabs()
  if (held.some((tab) => tabKey(tab) === key)) {
    // The same hold `placeTab` records when the address is NOT yet open. An explicit hold means the same
    // thing whichever branch runs, so both write the same pair; marking only `pinned` here left a resident
    // board tab held in memory and demoted back to a slot by the next reload's normalization.
    putTabs(held.map((tab) => (tabKey(tab) === key ? { ...tab, pinned: true, held: true } : tab)))
    pinKey = null
  }
}
export function pinTab(page, param = null, query = null) {
  markTabHold(page, param, query)
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
  if (!isHoldGesture(event)) return false
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

// Session rows are allowed to replace the current session slot only when their document is not already
// held. Resolve that identity in the one workspace store first, then let the caller's surface own the
// actual route write (Dock uses shell navigation; Sessions uses its ViewScope). This prevents a click on B
// from rewriting A's address while the reader is looking at A.
export function focusSessionTab(id, open) {
  if (!id) return false
  const held = getTabs().find((tab) => tab.page === 'sessions' && tab.param === id)
  const route = { page: 'sessions', param: id, query: null }
  open?.(held ? { ...route } : route)
  return !!held
}

export function useTabs({ onCloseStart } = {}) {
  const route = useRoute()
  const [tabs, setTabs] = useState(getTabs)
  const onCloseStartRef = useRef(onCloseStart)
  useEffect(() => { onCloseStartRef.current = onCloseStart }, [onCloseStart])
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
    touch(key)
  }, [route.page, route.param, route.query])

  // Resident view routes keep their detail address in the URL but focus the one top-level view tab.
  const activeKey = tabKey(route)

  const open = useCallback((tab) => navigate(tab.page, tab.param, { query: tab.query }), [])

  // Closing hands the workspace to the last-focused surviving tab across kinds (the document the reader
  // actually came from). Resource tabs keep their owning session return contract. With no focus history,
  // `closeDestination` falls back to nearest same-kind position, then nearest any-kind position; it is the one
  // selector and the focus history is its only extra input.
  const close = useCallback((tab) => {
    const key = tabKey(tab)
    const prev = getTabs()
    const i = prev.findIndex((t) => tabKey(t) === key)
    if (i < 0) return
    onCloseStartRef.current?.(tab)
    const next = prev.filter((_, n) => n !== i)
    putTabs(next)
    recent = recent.filter((k) => k !== key)
    if (key === activeKey) {
      const destination = closeDestination(tab, next, i, recent)
      navigate(destination.page, destination.param, { query: destination.query })
    }
  }, [activeKey])

  const closeOthers = useCallback((tab) => {
    const key = tabKey(tab)
    const prev = getTabs()
    prev.filter((t) => tabKey(t) !== key).forEach((closingTab) => onCloseStartRef.current?.(closingTab))
    putTabs(prev.filter((t) => tabKey(t) === key))
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
    // The keyboard's half of the hold. The pointer gestures all name an address the reader is pointing at;
    // a keyboard has no such target, so the chord holds the document already showing — the tab a reader
    // would otherwise have to reach for with a double-click to stop ordinary browsing from replacing it.
    hold: () => {
      const active = getTabs().find((tab) => tabKey(tab) === activeKey)
      if (active && !active.pinned) pinTab(active.page, active.param, active.query)
      return active || null
    },
    active: () => getTabs().find((tab) => tabKey(tab) === activeKey) || null,
  }), [activeKey, open, close])

  return useMemo(() => ({ tabs, activeKey, open, close, closeOthers, move }), [tabs, activeKey, open, close, closeOthers, move])
}
