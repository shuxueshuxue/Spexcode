import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { scopedKey } from './project.js'
import { navigate, parseRoute, useRoute } from './route.js'
import { isDocument } from './viewCatalog.js'
import { closeDestination, focusTab, groupHolding, groupId as groupId_, groupOf, groupsOf, moveTab,
  moveTabToGroup, normalizeLayout, placeTab, resizeSplit, splitGroup, tabKey, tabRoute, updateGroup } from './tabModel.js'

export { closeDestination, focusTab, moveTab, placeTab, tabKey }

// A tab title is presentation metadata, not identity. Keeping it beside the address lets a session tab retain
// its last known name after the live session projection removes the closed session.
export const setTabTitle = (tabOrKey, title) => {
  const key = typeof tabOrKey === 'string' ? tabOrKey : tabKey(tabOrKey)
  const value = typeof title === 'string' ? title.trim() : ''
  const held = getLayout()
  const owner = groupHolding(held.root, key)
  const current = owner?.tabs.find((tab) => tabKey(tab) === key)
  if (!current || current.page !== 'sessions' || !current.param || current.param === 'new' || !value || current.title === value) return
  put({ root: updateGroup(held.root, owner.id, (group) => ({ ...group, tabs: group.tabs.map((tab) => (tabKey(tab) === key ? { ...tab, title: value } : tab)) })), focus: held.focus })
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
const KEY = scopedKey('spexcode.layout')
// THE RETIRED SHAPES, read once. A flat list was the workspace when there was one strip; a list plus a held
// slot was the workspace when there were two regions. Both are valid trees with one or two groups, so they
// migrate here and their keys go, rather than living on as a second source of truth.
const LEGACY_TABS_KEY = scopedKey('spexcode.tabs')
const LEGACY_HELD_KEY = scopedKey('spexcode.held')
const LEGACY_SPLIT_KEY = scopedKey('spexcode.split')

const readRaw = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved?.root) return saved
    const tabs = JSON.parse(localStorage.getItem(LEGACY_TABS_KEY) || '[]')
    const held = JSON.parse(localStorage.getItem(LEGACY_HELD_KEY) || localStorage.getItem(LEGACY_SPLIT_KEY) || 'null')
    if (!Array.isArray(tabs)) return null
    if (held?.page) return { root: { dir: 'row', ratio: 0.5, children: [{ tabs }, { tabs: [held] }] } }
    return { root: { tabs } }
  } catch { return null }
}
const write = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
    for (const retired of [LEGACY_TABS_KEY, LEGACY_HELD_KEY, LEGACY_SPLIT_KEY]) localStorage.removeItem(retired)
  } catch { /* private mode */ }
}

// Which routes are worth a tab is the VIEW REGISTRY's answer, not a second list here. It was a second list
// for one commit, and in that commit the strip could not hold the document addresses the registry had
// already declared — two sources of truth disagreeing exactly where they were supposed to agree.

// ONE workspace, however many components read it: the strip of every group draws from this store, the shell
// lays the tree out from it, and the session console asks it which resource previews are still open. Per
// component state made those callers copies that could disagree — a command routed through the module
// updated whichever copy had registered last, and the strip kept drawing the other.
let layout = null            // { root, focus } — see [[tab-strip]]'s tree
let hydrated = false
const listeners = new Set()
const hydrate = () => {
  if (hydrated) return
  hydrated = true
  // the read boundary repairs whatever it finds: empty groups, a focus naming nothing, one document in two
  // groups, an older release's shape. A workspace is painted only after it is valid.
  layout = normalizeLayout(readRaw(), isDocument)
  write()
}
const getLayout = () => { hydrate(); return layout }
const emit = () => { for (const listener of [...listeners]) listener(layout) }
const put = (next) => {
  hydrate()
  if (!next || (next.root === layout.root && next.focus === layout.focus)) return layout
  layout = { root: next.root, focus: groupOf(next.root, next.focus) ? next.focus : groupsOf(next.root)[0]?.id || null }
  write()
  emit()
  return layout
}
export const workspaceGroups = () => groupsOf(getLayout().root)
export const allTabs = () => workspaceGroups().flatMap((group) => group.tabs)
const focusedGroup = () => {
  const current = getLayout()
  return groupOf(current.root, current.focus) || groupsOf(current.root)[0] || null
}
// The group a document is drawn in owns which of its tabs is showing; the FOCUSED group additionally owns
// the address bar, so moving focus names that group's active document rather than leaving the URL behind.
export function focusGroup(id, { follow = true } = {}) {
  const current = getLayout()
  const group = groupOf(current.root, id)
  if (!group || current.focus === id) return
  put({ root: current.root, focus: id })
  const tab = group.tabs.find((item) => tabKey(item) === group.active) || group.tabs[0]
  if (follow && tab) navigate(tab.page, tab.param, { query: tab.query, replace: true })
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
  const held = new Set(allTabs().map(tabKey))
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
  appendKey = allTabs().some((tab) => tabKey(tab) === key) ? null : key
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
  const held = allTabs().filter(match)
  const last = held[held.length - 1]
  if (!last) return false
  navigate(last.page, last.param, { query: last.query })
  return true
}

// EVERY GROUP DRAWS ITSELF WITH THIS HOOK ([[tab-strip]]). `groupId` names the group whose strip is asking;
// without one the caller is asking about the workspace as a whole (the session console, which needs to know
// which resource previews are open anywhere) and the verbs act on the focused group.
export function useTabs(groupId = null, { onCloseStart } = {}) {
  const route = useRoute()
  const [current, setCurrent] = useState(getLayout)
  const onCloseStartRef = useRef(onCloseStart)
  useEffect(() => { onCloseStartRef.current = onCloseStart }, [onCloseStart])
  useEffect(() => {
    listeners.add(setCurrent)
    setCurrent(getLayout())
    return () => { listeners.delete(setCurrent) }
  }, [])

  // THE ADDRESS IS ALWAYS SOMEWHERE IN THE WORKSPACE, because a workspace that claimed to show what is open
  // while the reader looked at something absent from it would be lying. It lands in the FOCUSED group —
  // unless another group already holds it, in which case that group is focused instead: one document, one
  // place. Every caller runs this and the rest are no-ops.
  useEffect(() => {
    const key = tabKey(route)
    const priorKey = focusedKey
    focusedKey = key
    if (appendKey && appendKey !== key) appendKey = null
    if (!isDocument(route.page, route.param)) return
    const held = getLayout()
    const holder = groupHolding(held.root, key)
    if (holder) {
      const active = groupOf(held.root, holder.id).active === key
      put({ root: active ? held.root : updateGroup(held.root, holder.id, (group) => ({ ...group, active: key })), focus: holder.id })
      // an already-open address may still differ in the part its identity drops (a face, a board's detail)
      put({ root: updateGroup(getLayout().root, holder.id, (group) => ({ ...group, tabs: placeTab(group.tabs, route, 'slot', key) })), focus: holder.id })
      touch(key)
      return
    }
    const target = focusedGroup()
    const mode = appendKey === key ? 'append' : 'slot'
    appendKey = null
    if (!target) {
      const id = groupId_()
      put({ root: { id, tabs: placeTab([], route, 'append'), active: key }, focus: id })
    } else {
      put({
        root: updateGroup(held.root, target.id, (group) => ({ ...group, tabs: placeTab(group.tabs, route, mode, priorKey), active: key })),
        focus: target.id,
      })
    }
    touch(key)
  }, [route.page, route.param, route.query])

  const layoutNow = current
  const group = (groupId && groupOf(layoutNow.root, groupId)) || (groupId ? null : focusedGroup())
  // the whole workspace's tabs are DERIVED, so they must be derived once per layout: a fresh array on every
  // render makes every effect that depends on it re-run, which is a render loop wearing a data shape.
  const tabs = useMemo(() => (groupId ? (group?.tabs || []) : groupsOf(layoutNow.root).flatMap((item) => item.tabs)),
    [groupId, group, layoutNow])
  const focused = !groupId || layoutNow.focus === groupId
  // Which tab a group shows is the group's own; the FOCUSED group's is also the address bar's.
  const activeKey = groupId ? (group?.active ?? null) : tabKey(route)
  const targetId = groupId || focusedGroup()?.id || null

  const open = useCallback((tab) => {
    if (targetId && getLayout().focus !== targetId) focusGroup(targetId, { follow: false })
    navigate(tab.page, tab.param, { query: tab.query })
  }, [targetId])

  // Closing removes exactly the selected tab from the group it is in. If that empties the group, the group
  // collapses and its space returns to its sibling ([[tab-lifecycle]]); the reader lands on the sibling's
  // own document rather than on a blank half-window.
  const close = useCallback((tab) => {
    const key = tabKey(tab)
    const held = getLayout()
    const owner = groupHolding(held.root, key)
    if (!owner) return
    const index = owner.tabs.findIndex((item) => tabKey(item) === key)
    onCloseStartRef.current?.(tab)
    const remaining = owner.tabs.filter((item) => tabKey(item) !== key)
    recent = recent.filter((k) => k !== key)
    const root = updateGroup(held.root, owner.id, (item) => ({
      ...item, tabs: remaining,
      active: remaining.some((t) => tabKey(t) === item.active) ? item.active : tabKey(remaining[Math.min(index, remaining.length - 1)] || {}) || null,
    }))
    const next = put({ root, focus: groupOf(root, owner.id) ? owner.id : groupsOf(root)[0]?.id || null })
    if (!next.root) { navigate('empty'); return }
    const landing = groupOf(next.root, next.focus)
    if (key !== tabKey(route)) return
    if (!groupOf(next.root, owner.id)) {
      const tabOf = landing?.tabs.find((item) => tabKey(item) === landing.active) || landing?.tabs[0]
      if (tabOf) navigate(tabOf.page, tabOf.param, { query: tabOf.query })
      return
    }
    const destination = closeDestination(tab, remaining, index, recent)
    navigate(destination.page, destination.param, { query: destination.query })
  }, [route])

  const closeOthers = useCallback((tab) => {
    const key = tabKey(tab)
    const held = getLayout()
    const owner = groupHolding(held.root, key)
    if (!owner) return
    owner.tabs.filter((item) => tabKey(item) !== key).forEach((closingTab) => onCloseStartRef.current?.(closingTab))
    put({ root: updateGroup(held.root, owner.id, (item) => ({ ...item, tabs: item.tabs.filter((t) => tabKey(t) === key), active: key })), focus: owner.id })
    if (key !== tabKey(route)) navigate(tab.page, tab.param, { query: tab.query })
  }, [route])

  // THE READER'S OWN ORDER, and their own arrangement. A drag inside a strip splices that group's list; a
  // drag that ends over ANOTHER group's strip moves the document there ([[tab-layout]]). Nothing here
  // navigates — a drag says where a document sits, never which one you are looking at — except that landing
  // in another group makes it that group's showing document, which is what "I put it there" means.
  const move = useCallback((key, before, intoGroup = null) => {
    const held = getLayout()
    const target = intoGroup || groupHolding(held.root, key)?.id
    if (!target) return
    const moved = moveTabToGroup(held.root, key, target, before)
    if (moved) put(moved)
  }, [])

  // SPLITTING IS THE SAME MOVE with a new place for it: the document leaves this group for a new one beside
  // (`row`) or below (`col`) it, and the new group takes focus — the reader pointed at that document, so
  // that is where they are now.
  const split = useCallback((tab, dir = 'row') => {
    const key = tabKey(tab)
    const held = getLayout()
    const owner = groupHolding(held.root, key)
    if (!owner) return
    const next = splitGroup(held.root, owner.id, key, dir)
    if (!next) return
    put(next)
    navigate(tab.page, tab.param, { query: tab.query })
  }, [])

  useEffect(() => registerTabCommands({
    closeActive: () => {
      const active = focusedGroup()?.tabs.find((tab) => tabKey(tab) === focusedGroup()?.active)
      if (active) close(active)
    },
    split: (dir) => {
      const owner = focusedGroup()
      const active = owner?.tabs.find((tab) => tabKey(tab) === owner.active)
      if (active) split(active, dir)
    },
    move: (dir) => {
      const list = focusedGroup()?.tabs || []
      const index = list.findIndex((tab) => tabKey(tab) === focusedGroup()?.active)
      if (index < 0 || list.length < 2) return
      open(list[(index + dir + list.length) % list.length])
    },
    focus: (ordinal) => {
      const target = focusTab(focusedGroup()?.tabs || [], ordinal)
      if (target) open(target)
    },
    active: () => focusedGroup()?.tabs.find((tab) => tabKey(tab) === focusedGroup()?.active) || null,
  }), [close, open, split])

  return useMemo(() => ({
    layout: layoutNow, group, tabs, activeKey, focused, groupId: targetId,
    open, close, closeOthers, move, split, focusGroup,
  }), [layoutNow, group, tabs, activeKey, focused, targetId, open, close, closeOthers, move, split])
}

// The WHOLE workspace, for the shell that lays it out.
export function useWorkspaceLayout() {
  const [current, setCurrent] = useState(getLayout)
  useEffect(() => {
    listeners.add(setCurrent)
    setCurrent(getLayout())
    return () => { listeners.delete(setCurrent) }
  }, [])
  return current
}

// A divider's drag names its split and the share the first child keeps.
export function resizeWorkspaceSplit(id, ratio) {
  const held = getLayout()
  put({ root: resizeSplit(held.root, id, ratio), focus: held.focus })
}


// The [[workspace-shell]] intent behind `scope.hold(address)`: a view names an ADDRESS, not a tab, so the
// address joins the focused group first (appended, never replacing what the reader is on) and is then split
// out of it into a group of its own.
export function holdAddress(route) {
  if (!route?.page || !isDocument(route.page, route.param ?? null)) return false
  const entry = { page: route.page, param: route.param ?? null, query: route.query ?? null }
  const key = tabKey(tabRoute(entry))
  const held = getLayout()
  if (groupHolding(held.root, key)) return true
  const target = focusedGroup()
  if (!target) return false
  const seeded = put({ root: updateGroup(held.root, target.id, (group) => ({ ...group, tabs: [...group.tabs, entry] })), focus: target.id })
  const split = splitGroup(seeded.root, target.id, key, 'row')
  if (split) put(split)
  return true
}
