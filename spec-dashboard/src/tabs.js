import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { navigate, parseRoute, useRoute } from './route.js'
import { isDocument } from './viewCatalog.js'
import { closeDestination, moveTab, normalizeTabs, placeTab, tabKey, tabRoute } from './tabModel.js'

export { closeDestination, moveTab, placeTab, tabKey }

// [[tab-strip]]: a tab IS a route, so opening several is the address grammar in the plural — not a second
// navigation model laid beside it.
//
// A NEW TAB IS A GESTURE, NEVER A SIDE EFFECT. Ordinary navigation replaces the focused tab when the new
// address is of the same kind; a tab of another kind, or an inactive tab of the same kind, is preserved and
// the new address is appended. A second tab of a kind is asked for explicitly — ctrl/⌘-click, a document's
// own "open in a new tab" action, or creating a session — and the tab that arrives is an ordinary tab: the
// next plain same-kind navigation replaces it like any other. There is no pinned or held tab. A tab that
// could not be replaced was a tab the reader had to remember the history of, and nobody does.
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
// module (⌥⇧X, a menu action) updated whichever copy had registered last, and the strip kept
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
// THE FOCUSED TAB, as the strip last saw it — the one address a plain navigation may replace. It is module
// state rather than per-hook state because every `useTabs` caller observes the same route sequence: the
// first subscriber to see a new route places it and moves this on, the rest find the address already open.
// A non-document route (the graph, the launch page) moves it to a key no tab has, so the next document
// navigation appends: nothing was focused, so nothing is replaced.
let focusedKey = null
const touch = (key) => {
  if (recent[0] === key) return
  const held = new Set(getTabs().map(tabKey))
  recent = [key, ...recent.filter((k) => k !== key && held.has(k))]
}
export const recentTabKeys = () => recent

// A row surface cannot reach the strip's state directly: an explicit "open in a new tab" MARKS the next
// navigation and the strip's route subscription reads the mark. The mark is an address, not a flag, so two
// subscribers (the strip and the session console both call useTabs) read the same answer for the same
// navigation; it is dropped when a different address arrives, which is the only way it can go stale.
let appendKey = null
let tabCommands = null
export function registerTabCommands(commands) {
  tabCommands = commands
  return () => { if (tabCommands === commands) tabCommands = null }
}
export function runTabCommand(name, ...args) {
  return tabCommands?.[name]?.(...args)
}
// THE NEW-TAB GESTURE, as ONE predicate. Every row surface asks the same question of the same event, so
// "ctrl/⌘-click opens this beside the current tab" cannot mean one thing in the finding dock and another on
// the Sessions page — which is exactly what it meant while each surface hand-rolled its own modifier test.
// Shift, alt and middle-click are deliberately NOT ours: they are the window-level gestures a browser gives a
// real anchor for free, and a reader asking for a second document beside the first is asking this workspace
// for a tab, not the browser for a second copy of the app.
export const isNewTabGesture = (event) => event.button === 0 && !event.shiftKey && !event.altKey
  && (event.ctrlKey || event.metaKey)

// The explicit new tab, split into its two halves. `markNewTab` records the intent WITHOUT writing the route,
// so a surface whose route writes belong to its own view scope ([[workspace-shell]]) can ask for a new tab
// without reaching around that boundary; `openNewTab` is the mark plus the navigation, for surfaces that own
// both. Ordinary navigation needs neither — `navigate` lands in the focused tab, which is what makes "a new
// tab is a gesture" true by default rather than by discipline at every call site.
//
// It marks the ADDRESS it was given, never "whatever is active", so a surface that navigated a moment ago
// cannot race React's processing of that navigation. An address already in the strip needs no mark: the
// placement simply focuses it.
export function markNewTab(page, param = null, query = null) {
  const key = tabKey(tabRoute({ page, param, query }))
  appendKey = getTabs().some((tab) => tabKey(tab) === key) ? null : key
}
export function openNewTab(page, param = null, query = null) {
  markNewTab(page, param, query)
  navigate(page, param, { query })
}

// The route an in-app hash href names, as `openNewTab` wants it. A row that is a REAL anchor already holds
// its address; nothing has to re-derive it from the data the row was built from.
export const routeOfHash = (href) => {
  const { page, param, query } = parseRoute(href)
  return { page, param, query: Object.keys(query || {}).length ? query : null }
}

// THE ROW GESTURE, for every finding surface whose rows are real anchors — the review lists, the spec
// context panels, the file tree. A plain click stays the anchor's: the browser writes the hash and the
// focused tab takes it, which is the default this workspace is built on. Ctrl/⌘ is the WORKSPACE's new tab
// rather than the browser's new window, because the reader asking for a second document beside the one they
// have is asking for a second tab in the strip, not a second copy of the app. Shift, alt and middle-click
// are left alone, so every window-level gesture a real anchor gives for free still works. Returns whether it
// took the event.
export function newTabAnchor(event, href) {
  if (!isNewTabGesture(event)) return false
  event.preventDefault()
  const route = routeOfHash(href)
  openNewTab(route.page, route.param, route.query)
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
    const priorKey = focusedKey
    focusedKey = key
    if (appendKey && appendKey !== key) appendKey = null
    if (!isDocument(route.page, route.param)) return
    const mode = appendKey === key ? 'append' : 'slot'
    appendKey = null
    putTabs(placeTab(getTabs(), route, mode, priorKey))
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
    active: () => getTabs().find((tab) => tabKey(tab) === activeKey) || null,
  }), [activeKey, open, close])

  return useMemo(() => ({ tabs, activeKey, open, close, closeOthers, move }), [tabs, activeKey, open, close, closeOthers, move])
}
