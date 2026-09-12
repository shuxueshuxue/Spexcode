import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopedKey } from './project.js'
import { navigate, parseRoute, useRoute } from './route.js'
import { isDocument } from './viewCatalog.js'
import { closeDestination, focusTab, moveTab, normalizeTabs, placeTab, tabKey, tabRoute } from './tabModel.js'

export { closeDestination, focusTab, moveTab, placeTab, tabKey }

// A tab title is presentation metadata, not identity. Keeping it beside the address lets a session tab retain
// its last known name after the live session projection removes the closed session.
export const setTabTitle = (tabOrKey, title) => {
  const key = typeof tabOrKey === 'string' ? tabOrKey : tabKey(tabOrKey)
  const value = typeof title === 'string' ? title.trim() : ''
  const current = getTabs().find((tab) => tabKey(tab) === key)
  if (!current || current.page !== 'sessions' || !current.param || current.param === 'new' || !value || current.title === value) return
  putTabs(getTabs().map((tab) => tabKey(tab) === key ? { ...tab, title: value } : tab))
}

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

// A tab is an address INSIDE a project, so the working set is stored under that project's scope
// ([[dashboard-shell]]'s `scopedKey`) — the gateway serves every project from one origin, and a bare key
// made every project's strip one strip.
const KEY = scopedKey('spexcode.tabs')
// THE HELD SLOT — the working set's second position ([[tab-strip]]). One document, beside the strip's list
// rather than inside it: sending a tab right MOVES it, so a document is in the strip or in the slot, never
// in both. The old `spexcode.split` key held a copied ROUTE beside an untouched strip; it is read once and
// migrated, because that shape is what put the same document in two places.
const HELD_KEY = scopedKey('spexcode.held')
const LEGACY_SPLIT_KEY = scopedKey('spexcode.split')

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
const readHeld = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(HELD_KEY) || localStorage.getItem(LEGACY_SPLIT_KEY) || 'null')
    const [entry] = raw?.page ? normalizeTabs([raw], isDocument) : []
    return entry || null
  } catch { return null }
}
const writeHeld = (held) => {
  try {
    localStorage.removeItem(LEGACY_SPLIT_KEY)
    if (held) localStorage.setItem(HELD_KEY, JSON.stringify(held))
    else localStorage.removeItem(HELD_KEY)
  } catch { /* private mode */ }
}

// Which routes are worth a tab is the VIEW REGISTRY's answer, not a second list here. It was a second list
// for one commit, and in that commit the strip could not hold the document addresses the registry had
// already declared — two sources of truth disagreeing exactly where they were supposed to agree.

// ONE working set, however many components read it. `useTabs` has more than one caller — the strip draws
// it, the session console reads it to know which resource previews are still open — and per-component
// state made those callers two copies of the same list that could disagree: a command routed through the
// module (⌥⇧X, a menu action) updated whichever copy had registered last, and the strip kept
// drawing the other. The store is the list; every caller subscribes to it.
let store = null
let heldStore = null
const listeners = new Set()
// ONE hydration for both halves, because their invariant is mutual: the held document is NOT in the strip,
// and a held document with an empty strip is not a layout — a reload that finds either (an older release, a
// second window, the retired split key) repairs it here rather than painting it.
let hydrated = false
const hydrate = () => {
  if (hydrated) return
  hydrated = true
  store = read()
  heldStore = readHeld()
  if (!heldStore) return
  const key = tabKey(heldStore)
  const withoutHeld = store.filter((tab) => tabKey(tab) !== key)
  if (withoutHeld.length !== store.length) { store = withoutHeld; write(store) }
  if (!store.length) { store = [heldStore]; heldStore = null; write(store); writeHeld(null) }
}
const getTabs = () => { hydrate(); return store }
const getHeld = () => { hydrate(); return heldStore }
const emit = () => { for (const listener of [...listeners]) listener({ tabs: store, held: heldStore }) }
const putTabs = (next) => {
  const stable = next
  if (stable === getTabs()) return stable
  store = stable
  write(stable)
  emit()
  return stable
}
// the two halves move together whenever a document crosses between them, so one write, one notification.
const putWorkingSet = (tabs, held) => {
  hydrate()
  if (tabs === store && held === heldStore) return
  if (tabs !== store) { store = tabs; write(store) }
  if (held !== heldStore) { heldStore = held; writeHeld(held) }
  emit()
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
  const [working, setWorking] = useState(() => ({ tabs: getTabs(), held: getHeld() }))
  const onCloseStartRef = useRef(onCloseStart)
  useEffect(() => { onCloseStartRef.current = onCloseStart }, [onCloseStart])
  useEffect(() => {
    listeners.add(setWorking)
    setWorking({ tabs: getTabs(), held: getHeld() })
    return () => { listeners.delete(setWorking) }
  }, [])
  const { tabs, held } = working

  // The current address is always present in the strip, because a strip that claimed to show what is open
  // while the reader looked at something absent from it would be lying. Every caller runs this and the
  // second one is a no-op: `placeTab` returns the list unchanged once the address is placed.
  useEffect(() => {
    const key = tabKey(route)
    const priorKey = focusedKey
    focusedKey = key
    if (appendKey && appendKey !== key) appendKey = null
    if (!isDocument(route.page, route.param)) return
    // NAVIGATING TO THE HELD DOCUMENT BRINGS IT BACK. The strip must contain the address the reader is on,
    // and one document cannot be in two places — so the slot releases it rather than the strip cloning it.
    const heldNow = getHeld()
    if (heldNow && tabKey(heldNow) === key) putWorkingSet([...getTabs(), heldNow], null)
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
    recent = recent.filter((k) => k !== key)
    // AN EMPTY STRIP BESIDE A HELD DOCUMENT IS NOT A LAYOUT: closing the last tab collapses the split and
    // the held document comes back as the one open document, rather than leaving "nothing open" beside it.
    const heldNow = getHeld()
    if (!next.length && heldNow) {
      putWorkingSet([heldNow], null)
      navigate(heldNow.page, heldNow.param, { query: heldNow.query })
      return
    }
    putTabs(next)
    if (key === activeKey) {
      const destination = closeDestination(tab, next, i, recent)
      navigate(destination.page, destination.param, { query: destination.query })
    }
  }, [activeKey])

  // SENDING A TAB TO THE SLOT IS A MOVE. It leaves the strip, so the working set still says each document is
  // in exactly one place; a document already in the slot returns to the strip in the slot the new one left
  // (a swap, not a discard). Holding the strip's only tab is refused: the move would leave the strip empty,
  // and the split would collapse right back — the caller shows the verb as unavailable rather than inert.
  const hold = useCallback((tab) => {
    const key = tabKey(tab)
    const prev = getTabs()
    const i = prev.findIndex((t) => tabKey(t) === key)
    if (i < 0 || prev.length < 2) return
    const previous = getHeld()
    const remaining = prev.filter((_, n) => n !== i)
    const restored = previous ? [...remaining.slice(0, i), previous, ...remaining.slice(i)] : remaining
    putWorkingSet(restored, prev[i])
    recent = recent.filter((k) => k !== key)
    if (key === activeKey) {
      const destination = closeDestination(tab, restored, i, recent)
      navigate(destination.page, destination.param, { query: destination.query })
    }
  }, [activeKey])

  // The slot's one control returns its document to the strip and focuses it — the exact inverse of the move,
  // so nothing is discarded by the gesture that ends the split. Closing it for good is then the ordinary tab
  // close, on the tab it just became.
  const release = useCallback(() => {
    const current = getHeld()
    if (!current) return
    putWorkingSet([...getTabs(), current], null)
    navigate(current.page, current.param, { query: current.query })
  }, [])

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
    hold: (tab) => {
      const target = tab || getTabs().find((item) => tabKey(item) === activeKey)
      if (target) hold(target)
    },
    release,
    held: () => getHeld(),
    move: (dir) => {
      const list = getTabs()
      const index = list.findIndex((tab) => tabKey(tab) === activeKey)
      if (index < 0 || list.length < 2) return
      open(list[(index + dir + list.length) % list.length])
    },
    focus: (ordinal) => {
      const target = focusTab(getTabs(), ordinal)
      if (target) open(target)
    },
    active: () => getTabs().find((tab) => tabKey(tab) === activeKey) || null,
  }), [activeKey, open, close, hold, release])

  return useMemo(() => ({ tabs, held, activeKey, open, close, closeOthers, move, hold, release }),
    [tabs, held, activeKey, open, close, closeOthers, move, hold, release])
}

// The [[workspace-shell]] intent behind `scope.hold(address)`: a view names an ADDRESS, not a tab, so the
// address joins the working set first (appended, never replacing what the reader is on) and is then moved
// into the slot by the one move above.
export function holdAddress(route) {
  if (!route?.page || !isDocument(route.page, route.param ?? null)) return false
  const entry = { page: route.page, param: route.param ?? null, query: route.query ?? null }
  const key = tabKey(tabRoute(entry))
  const held = getHeld()
  if (held && tabKey(held) === key) return true
  const tabs = getTabs()
  const present = tabs.find((tab) => tabKey(tab) === key)
  const list = present ? tabs : [...tabs, entry]
  if (list.length < 2) return false
  const index = list.findIndex((tab) => tabKey(tab) === key)
  const remaining = list.filter((_, n) => n !== index)
  putWorkingSet(held ? [...remaining.slice(0, index), held, ...remaining.slice(index)] : remaining, list[index])
  return true
}
