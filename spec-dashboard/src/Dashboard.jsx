import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, MarkerType, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeContextMenu from './NodeContextMenu.jsx'
import NodeView, { panesFor } from './NodeView.jsx'
import FocusPanel from './FocusPanel.jsx'
import SessionWindow, { LockGlyph } from './SessionWindow.jsx'
import Legend from './Legend.jsx'
import SpecSearch from './SpecSearch.jsx'
import GraphStats from './GraphStats.jsx'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import { useRoute, navigate } from './route.js'
import { navigateAddress } from './address.js'
import { useResizable } from './useResizable.js'
import { layout, X_GAP, Y_GAP } from './data.js'
import { createMomentumScroll } from './scroll.js'
import { cycleNext } from './cycle.js'
import { firesKey, keysOf } from './bindings.js'
import { returnFocus } from './focus.js'
import { labelColor } from './color.js'
import { sessionHeadline } from './session.js'
import { lockCycleKeyLabels, showLockCycleKeys } from './lockHint.js'
import { useT } from './i18n/index.jsx'

// code-split the heavy leaves off the desktop entry chunk: the session console drags in xterm (+addons),
// the evals/issues pages the video annotator — none of which the first graph paint needs. SessionInterface
// still MOUNTS immediately (warm terminals — its chunk is fetched right after the shell paints); the routed
// pages fetch on first visit.
const SessionInterface = lazy(() => import('./SessionInterface.jsx'))
const EvalsPage = lazy(() => import('./EvalsPage.jsx'))
const IssuesPage = lazy(() => import('./IssuesPage.jsx'))
const Settings = lazy(() => import('./Settings.jsx'))
const ProjectsPage = lazy(() => import('./ProjectsPage.jsx'))

const nodeTypes = { spec: SpecNode }
// node box (used only to centre the camera on a node). NW/NH must track the .spec-node size in
// styles.css: it's now two rows (title line + editor/last-edited line) and a bit wider for longer titles.
const NW = 220, NH = 46
const clamp = (z) => Math.max(0.4, Math.min(1.6, z))

// nn = new child under focus, dd = delete focus; leaders n/d are unbound on the board so single-key nav isn't shadowed.
// These only PREFILL a plain instruction the launched agent carries out itself — node create/delete is
// prompt-driven work, never a server op ([[mentions]]: the issue store is the only programmatic surface).
const CHORDS = {
  nn: (id) => `Create a new spec node under [[${id}]] — choose a kebab-case id, write its spec.md at contract altitude with a code: list, implement it, then propose merge. What it should be: `,
  dd: (id) => `Delete the [[${id}]] spec node — remove its dir, repoint or fold its governed code, fix any [[…]] refs, recover its intent from git history, then propose merge. Why: `,
}
const CHORD_KEYS = Object.keys(CHORDS)
const CHORD_LEADERS = new Set(CHORD_KEYS.map((c) => c[0]))

function Dashboard({ specs, sessions, reload, project, issuesData, reloadIssues, catalog }) {
  // the URL is the page switch ([[side-nav]]): #/graph | #/sessions[/<sel>] | #/issues | #/settings.
  // `page` replaces the old boolean overlay states (sessionUI / settings-modal) — the sidebar, the keyboard,
  // and the address bar all drive the same route.
  const { page, param } = useRoute()
  // focus survives a reload / a mobile↔desktop breakpoint remount within this tab (sessionStorage, so a
  // fresh tab still opens on the root); a stale saved id is fine — focusRaw below falls back to the root.
  const [focusId, setFocusId] = useState(() => {
    let saved = null
    try { saved = sessionStorage.getItem('spex.focus') } catch { /* storage may be walled off */ }
    return (saved && specs.some((s) => s.id === saved) ? saved : null) || specs.find((s) => !s.parent)?.id
  })
  useEffect(() => { try { if (focusId) sessionStorage.setItem('spex.focus', focusId) } catch { /* */ } }, [focusId])
  const [overlay, setOverlay] = useState(false)   // node-info popup (opened by `i`)
  const [pane, setPane] = useState('spec')
  const [legend, setLegend] = useState(false)     // centered help modal: keymap + visual vocabulary (`?`)
  const [search, setSearch] = useState(null)      // search palette mode: null | 'nodes' (`/`, nodes lead) | 'sessions' (⌘/Ctrl+/, sessions lead)
  const [sessionSel, setSessionSel] = useState('new') // persisted across open/close: last tab/session
  const [highlightId, setHighlightId] = useState(null) // session whose overlays are emphasised
  const [seed, setSeed] = useState(null)          // one-shot text a board chord pre-fills the New Session input with
  const [evalSeed, setEvalSeed] = useState(null)  // one-shot eval deep link ({node,scenario}|{}) from #/sessions/<id>/eval[/…]
  const [nodeMenu, setNodeMenu] = useState(null)  // node right-click menu: { x, y, id } | null ([[node-menu]])
  const { getViewport, setViewport } = useReactFlow()
  const t = useT()
  const graphRef = useRef(null)
  const animRef = useRef(0)
  const chordRef = useRef({ buf: '', timer: 0 })  // pending board-chord buffer (see onKey)
  const [kbdMode, setKbdMode] = useState(false)
  const kbdRef = useRef(false); kbdRef.current = kbdMode
  const lastMouseRef = useRef({ x: -1, y: -1 })
  // two instances so the popup pane and the help body keep independent scroll targets (createMomentumScroll, scroll.js)
  const popupScroll = useMemo(() => createMomentumScroll(), [])
  const legendScroll = useMemo(() => createMomentumScroll(), [])

  // resolve focus on the RAW tree first (resilient to a polled-away merged/closed node), then expand.
  const rawById = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  const focusRaw = rawById[focusId] || specs.find((s) => !s.parent) || specs[0]
  const expanded = useMemo(() => {
    const set = new Set()
    for (let cur = focusRaw; cur; cur = cur.parent ? rawById[cur.parent] : null) set.add(cur.id)
    return set
  }, [focusRaw, rawById])
  // VISIBLE nodes are exactly those the layout placed (root, or a child of an expanded node); they carry
  // the x/y all geometry/render below works on. Hidden subtrees simply aren't in `specs2`.
  const placed = useMemo(() => layout(specs, expanded), [specs, expanded])
  const specs2 = useMemo(() => specs.filter((s) => placed[s.id]).map((s) => ({ ...s, ...placed[s.id] })), [specs, placed])
  const byId = useMemo(() => Object.fromEntries(specs2.map((s) => [s.id, s])), [specs2])
  const focus = byId[focusRaw.id]
  // direct-child count per node — drives the ▸N collapsed hint
  const childCount = useMemo(() => {
    const m = {}
    specs.forEach((s) => { if (s.parent) m[s.parent] = (m[s.parent] || 0) + 1 })
    return m
  }, [specs])
  // changed nodes from the RAW tree (so the o-cycle reaches collapsed subtrees), kept in backend order for a stable cycle
  const overlayNodes = useMemo(() => specs.filter((s) => s.overlays?.length), [specs])

  // lockedSession = the locked row (banner name/colour); lockedNodes = its changed nodes from the RAW tree (cycle reach)
  const lockedSession = useMemo(
    () => (highlightId ? sessions.find((s) => s.source === highlightId) : null),
    [sessions, highlightId],
  )
  const lockedNodes = useMemo(
    () => (highlightId ? specs.filter((s) => (s.overlays || []).some((o) => o.source === highlightId)) : []),
    [specs, highlightId],
  )
  const cycleNodes = useMemo(() => (highlightId ? lockedNodes : overlayNodes), [highlightId, lockedNodes, overlayNodes])
  const lockCycleKeys = lockCycleKeyLabels(keysOf)

  const liveEditorsOf = useCallback(
    (node) => (node ? sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id)) : []),
    [sessions],
  )

  const openSession = useCallback((id) => { setSessionSel(id); navigate('sessions', id) }, [])
  const startNew = useCallback((text) => { setSessionSel('new'); setSeed(text); navigate('sessions', 'new') }, [])
  const onNavigateAddress = useCallback((address) => {
    navigateAddress(address, { onFocusNode: setFocusId, onOpenSession: openSession })
  }, [openSession])

  // sessions overlaying the right-clicked node — its live worktrees (overlay.source === session.source).
  // The node-menu appends one item per session below its verbs, the one mouse path into an existing
  // session ([[node-menu]]); recomputed only while the menu is open on a node.
  const menuSessions = useMemo(() => {
    if (!nodeMenu) return []
    const node = specs.find((n) => n.id === nodeMenu.id)
    if (!node?.overlays?.length) return []
    const srcs = [...new Set(node.overlays.map((o) => o.source))]
    return srcs.map((src) => sessions.find((s) => s.source === src)).filter(Boolean)
  }, [nodeMenu, specs, sessions])
  // one routing for BOTH palettes (board `/` and session-board ⌘/Ctrl+/): each row carries an app address
  // (graph node, session tab, issue detail, or eval detail). The palette's caller supplies only the view
  // callbacks needed for non-hash state; the address helper owns the route shape.
  const onSearchPick = useCallback((e) => {
    onNavigateAddress(e.address)
  }, [onNavigateAddress])

  // sel ↔ URL, two one-way syncs that converge: a deep-linked / history-walked `#/sessions/<sel>` applies
  // its param to the selection; a selection made in the UI is ECHOED into the hash with replace (no history
  // entry per tab-hop — pages push, tabs replace, see route.js).
  // the sessions param is '<id>' or '<id>/eval[/<node>/<scenario>]' (the page splits, like evals): the id
  // applies to the selection; the segments past it are a ONE-SHOT deep link ([[session-eval]]) seeding the
  // console's Eval tab (and optionally one scenario's reading), then the echo below normalizes the hash
  // back to the plain tab address — the link is an entrance, not a synced view state.
  useLayoutEffect(() => {
    if (page !== 'sessions' || !param) return
    const [id, entrance, node, ...scen] = param.split('/')
    if (id && id !== sessionSel) setSessionSel(id)
    if (entrance === 'eval') setEvalSeed({ node: node || null, scenario: scen.join('/') || null })
  }, [page, param]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (page === 'sessions') navigate('sessions', sessionSel, { replace: true })
  }, [page, sessionSel])

  // a transient graph overlay never outlives the graph page — navigating away closes it, so a return
  // lands on the plain page (the session interface is a page now, not part of this overlay set).
  useEffect(() => {
    if (page !== 'graph') { setOverlay(false); setLegend(false); setSearch(null); setNodeMenu(null) }
  }, [page])

  const children = useMemo(() => specs2.filter((s) => s.parent === focus.id), [specs2, focus])
  const parent = focus.parent ? byId[focus.parent] : null

  // child is to the RIGHT; pick the one nearest in y.
  const childTarget = useMemo(() => {
    if (!children.length) return null
    return children.reduce((best, c) => (Math.abs(c.y - focus.y) < Math.abs(best.y - focus.y) ? c : best))
  }, [children, focus])

  const rightTarget = useMemo(() => {
    if (childTarget) return childTarget
    let best = null, bestD = Infinity
    for (const s of specs2) {
      const dx = s.x - focus.x
      if (dx <= 0) continue
      const dy = s.y - focus.y
      const d = (dx / X_GAP) ** 2 + (dy / Y_GAP) ** 2
      if (d < bestD) { bestD = d; best = s }
    }
    return best
  }, [childTarget, specs2, focus])

  const nearestY = useCallback((dir) => {
    let best = null
    for (const s of specs2) {
      if (s.id === focus.id || s.x !== focus.x) continue
      const dy = s.y - focus.y
      if (dir === 'down' ? dy <= 0 : dy >= 0) continue
      if (!best || Math.abs(dy) < Math.abs(best.y - focus.y)) best = s
    }
    return best
  }, [specs2, focus])
  const downTarget = useMemo(() => nearestY('down'), [nearestY])
  const upTarget    = useMemo(() => nearestY('up'), [nearestY])

  // per-node className: focus-kin dimming, or overlay spotlight when a session is locked; recomputed each poll
  const nodes = useMemo(() => {
    return specs2.map((s) => {
    const kin = s.id === focusId || s.id === focus.parent || s.parent === focusId || s.parent === focus.parent
    let className
    // a session with pending node changes dims the board to spotlight them; a session with NONE
    // locks without greying everything (there's nothing to spotlight — the top banner says so), so
    // the board keeps its normal focus-kin dimming.
    if (highlightId && lockedNodes.length) {
      className = (s.overlays || []).some((o) => o.source === highlightId) ? 'ov-hot' : 'ov-dim'
    } else {
      className = kin ? undefined : 'is-far'
    }
    // a node with live editor(s) carries an `editors` list (SpecNode's second row draws their avatars),
    // driven by the live overlay (pending ops), NOT node.session. `editors` is the minimal slice each
    // avatar needs: id (the avatar seed + tooltip), status (liveness ring), node (tooltip label).
    const editors = liveEditorsOf(s)
    const editorData = editors.map((e) => ({ id: e.id, status: e.status, node: e.node }))
    // collapsed = has children but its subtree is hidden (not on the expanded spine) -> show the ▸N hint.
    const kids = childCount[s.id] || 0
    const extra = { editors: editorData, collapsed: kids > 0 && !expanded.has(s.id), childCount: kids }
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y },
      data: { ...s, ...extra },
      draggable: false, selected: s.id === focusId, className,
    }
    })
  }, [focusId, focus.parent, highlightId, lockedNodes, specs2, liveEditorsOf, childCount, expanded])

  const edges = useMemo(() => {
    const tree = specs2.filter((s) => s.parent).map((s) => {
      const hot = s.id === focusId || s.parent === focusId
      return {
        id: `${s.parent}-${s.id}`, source: s.parent, target: s.id, type: 'smoothstep',
        style: { stroke: hot ? 'var(--blue)' : 'var(--line)', strokeWidth: hot ? 2 : 1 }, zIndex: hot ? 1 : 0,
      }
    })
    const moves = []
    for (const s of specs2) {
      const mv = (s.overlays || []).find((o) => o.op === 'moved' && o.toParent && byId[o.toParent])
      if (!mv) continue
      const stroke = labelColor(mv.seed)
      moves.push({
        id: `move-${s.id}-${mv.toParent}`, source: s.id, target: mv.toParent, type: 'smoothstep',
        animated: true, zIndex: 2, className: 'move-edge',
        style: { stroke, strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      })
    }
    return [...tree, ...moves]
  }, [focusId, specs2, byId])

  // flat-pan the viewport to centre a target node.
  const animateView = useCallback((target, dur) => {
    const start = getViewport()
    const t0 = performance.now()
    cancelAnimationFrame(animRef.current)
    const step = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1
      const e = 1 - Math.pow(1 - p, 3)
      setViewport({
        x: start.x + (target.x - start.x) * e,
        y: start.y + (target.y - start.y) * e,
        zoom: start.zoom + (target.zoom - start.zoom) * e,
      })
      if (p < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
  }, [getViewport, setViewport])

  // recentre on a node; when `zoom` is omitted (arrow-nav) the current zoom is reused, so it's a pure flat-pan
  const centerOn = useCallback((node, zoom, dur = 300) => {
    const el = graphRef.current
    if (!el) return
    const z = zoom ?? getViewport().zoom
    animateView({ x: el.clientWidth / 2 - (node.x + NW / 2) * z, y: el.clientHeight / 2 - (node.y + NH / 2) * z, zoom: z }, dur)
  }, [animateView, getViewport])

  // center the root once after the graph page's first VISIBLE paint; thereafter the follow effect owns the
  // camera. Gated on the route: a deep-load on another page keeps the graph hidden (zero-sized), so framing
  // waits for the first visit instead of measuring a display:none container.
  const framedRef = useRef(false)
  useEffect(() => {
    if (framedRef.current || page !== 'graph') return
    framedRef.current = true
    const id = requestAnimationFrame(() => centerOn(focus, undefined, 0))
    return () => cancelAnimationFrame(id)
  }, [centerOn, focus, page])

  // The camera follows the KEYBOARD, not the mouse ([[keyboard-nav]]): a keyboard or programmatic focus move
  // pans to recenter the new focus; a mouse click expands in place and the board STAYS. Node positions are a
  // fixed structural embedding — a node's x/y depends only on tree shape, never on which node is focused — so a
  // click's expand shifts nothing already on screen; only the camera would move, and that's the keyboard's alone.
  // Fires on focusId alone (not the poll); reads latest focus/centerOn via refs; skips the first paint.
  const focusRef = useRef(focus); focusRef.current = focus
  const centerRef = useRef(centerOn); centerRef.current = centerOn
  const followedRef = useRef(false)
  const skipCenterRef = useRef(false)   // a mouse click sets this so the follow effect leaves the board where it is
  // lastCenteredRef makes the follow route-safe: a focus set while ANOTHER page is up (an issues-page node chip, a
  // search pick) can't measure the hidden zero-sized graph, so the pan runs when the graph page shows again —
  // and an unchanged focus doesn't re-pan on every page return.
  const lastCenteredRef = useRef(null)
  useEffect(() => {
    if (page !== 'graph') return
    if (!followedRef.current) { followedRef.current = true; lastCenteredRef.current = focusId; return }
    if (skipCenterRef.current) { skipCenterRef.current = false; lastCenteredRef.current = focusId; return }   // mouse-click focus move: no pan
    if (lastCenteredRef.current === focusId) return
    lastCenteredRef.current = focusId
    centerRef.current(focusRef.current)
  }, [focusId, page])

  // focus-return boundary ([[focus-return]]): a transient overlay (search / help / node popup) takes focus
  // when it opens; when the LAST one closes, hand focus back to whoever held it — else the docked sink.
  // Never <body>. Pages (the session board, evals, issues, settings) are surfaces with their own focus discipline,
  // not transient overlays, so they stay out of this set.
  const anyOverlay = overlay || legend || !!search
  const hadOverlay = useRef(anyOverlay)
  useEffect(() => {
    if (hadOverlay.current && !anyOverlay) returnFocus()
    hadOverlay.current = anyOverlay
  }, [anyOverlay])

  // capture phase so we beat react-flow; while a modal is open it owns the keys (guards below)
  useEffect(() => {
    // the focused node's actual tabs (panesFor), so pane-nav matches what NodeView renders for THIS node
    const paneKeys = panesFor(focus).map((p) => p.key)
    const cyclePane = (dir) => setPane((p) => { const i = paneKeys.indexOf(p); return paneKeys[((i < 0 ? 0 : i) + dir + paneKeys.length) % paneKeys.length] })
    // nav just moves focus; the follow-focus effect recenters once the tree has re-plotted around the new
    // focus (passing the stale pre-re-plot node straight to centerOn would aim at its OLD coordinates).
    const go = (t, e) => { if (t) { e.preventDefault(); e.stopPropagation(); setKbdMode(true); setFocusId(t.id) } }
    // only one pane is mounted, so the first matching `.ov-body` descendant is the scroller (scroll.js drops a stale target)
    const bumpScroll = (delta) => popupScroll(
      document.querySelector('.ov-body .pane-doc, .ov-body .pane-hist, .ov-body .pane-issues, .ov-body .pane-eval, .ov-body .pane-edit'), delta)
    const onKey = (e) => {
      // the GLOBAL ⌥ page vocabulary ([[side-nav]]): ⌥1..⌥5 jump straight to a page in rail order, ⌥N to the
      // New Session composer, ⌥F to the Evals page (the leading loss surface) — from ANY page, matched by
      // e.code (⌥-digit/letter on a mac emits dead-key glyphs for e.key). The console's type mode yields these
      // on purpose (its earlier capture listener falls through the ⌥ command family instead of forwarding it
      // to tmux). Firing one also dismisses the search palette — the navigation intent wins over the modal.
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const pageOf = { Digit1: 'graph', Digit2: 'sessions', Digit3: 'evals', Digit4: 'issues', Digit5: 'settings' }
        const target = pageOf[e.code]
        if (target) { e.preventDefault(); e.stopPropagation(); setSearch(null); navigate(target); return }
        if (e.code === 'KeyN') { e.preventDefault(); e.stopPropagation(); setSearch(null); setSessionSel('new'); navigate('sessions', 'new'); return }
        if (e.code === 'KeyF') { e.preventDefault(); e.stopPropagation(); setSearch(null); navigate('evals'); return }
      }
      // The search palette is a modal: while open it owns its keys over ANY surface — the board OR the session
      // interface (the session interface yields via its searchOpen guard). The SpecSearch input owns ↑/↓/Enter/
      // typing; App only catches Esc here so it closes even if the input blurred. This guard sits ABOVE the
      // sessionUI return so it holds when the palette is opened over the session board.
      if (search) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSearch(null) }
        return
      }
      // ⌘/Ctrl+/ opens the SAME palette with SESSIONS boosted — the session board's search escape-hatch,
      // reachable even while the session interface owns its keys. Plain `/` on the board stays nodes-first (below).
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); e.stopPropagation(); setSearch('sessions'); return }
      // Everything below is the plain-key board vocabulary. Browser/system accelerators that happen to use
      // the same base key (`Ctrl/⌘+L`, `Ctrl/⌘+,`, `Alt+←`, …) pass through unless declared above.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // A focused native control owns its activation keys: Enter/Space on a button, link, or form field is
      // that control's click — tabbing to the HUD `?` and pressing Enter must equal clicking it — so the
      // board vocabulary (board.info's Enter alias included) steps aside and lets the default action fire.
      // Graph tiles never collide: nodesFocusable is off, so board focus is never DOM focus on a control.
      if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('button, a[href], input, select, textarea, summary')) return
      if (page === 'sessions') return // the session interface owns ALL its keys (arrows / Enter / typing / Esc / the graph)
      // the Evals and Issues pages own their own keys (j/k list-walk, their inputs, their own Esc stack) —
      // EvalsPage / IssuesPage handle them. Esc does NOT route pages anywhere ([[side-nav]]) — leaving is
      // ⌥1..⌥5, the rail, or history.
      if (page === 'evals' || page === 'issues') return
      // the settings page: `,` toggles back home; typing inside its shortcut-capture stays its own
      if (page === 'settings') {
        if (firesKey('graph.settings', e.key)) { e.preventDefault(); e.stopPropagation(); navigate('graph') }
        return
      }
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
        // the popup is a LENS, not a modal ([[keyboard-nav]]): Shift+nav (⇧h/j/k/l, ⇧arrows) walks the
        // tree exactly like the bare board — the popup stays open and follows the new focus (NodeView is
        // keyed by focus.id; the pane survives via NodeView's own fallback). Shift+Tab stays pane-cycling:
        // Tab never matches a nav binding, so it falls through to its own branch below.
        if (e.shiftKey) {
          if (firesKey('nav.up', e.key))     return go(upTarget, e)
          if (firesKey('nav.down', e.key))   return go(downTarget, e)
          if (firesKey('nav.parent', e.key)) return go(parent, e)
          if (firesKey('nav.child', e.key))  return go(rightTarget, e)
        }
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return }
        // ←/→ or h/l cycle the panes (like Tab and 1/2)
        if (e.key === 'ArrowLeft'  || e.key === 'h') { e.preventDefault(); e.stopPropagation(); cyclePane(-1); return }
        if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); e.stopPropagation(); cyclePane(1); return }
        if (/^[1-9]$/.test(e.key) && +e.key <= paneKeys.length) { e.preventDefault(); e.stopPropagation(); setPane(paneKeys[+e.key - 1]); return }
        // j/k and ↑/↓ scroll the open pane; in the history pane reaching the end also reveals the next version (see HistoryPane)
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          bumpScroll(e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return
        }
        // Enter is INERT here: the info popup is a pure reading surface, not a launchpad. Crossing into
        // the node's live session is a right-click node-menu action ([[node-menu]]), never a keystroke —
        // so Enter (like any other key) is swallowed and does nothing, leaving the popup open.
        return // anything else does NOT move the board behind the popup
      }
      // graph mode. The help modal owns its keys while open (only ?/Esc close it)
      if (legend) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setLegend(false); return }
        // j/k and ↑/↓ scroll the (often taller-than-viewport) help body — same momentum glide as the
        // popup pane, via the legend's own scroller instance. The `.legend` panel is the overflow box.
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          legendScroll(document.querySelector('.legend'), e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return
        }
        return
      }
      if (firesKey('graph.help', e.key)) { e.preventDefault(); setLegend(true); return }
      if (e.key === 'Escape' && highlightId) { e.preventDefault(); e.stopPropagation(); setHighlightId(null); return }
      if (firesKey('graph.settings', e.key)) { e.preventDefault(); navigate('settings'); return }
      if (firesKey('graph.search', e.key)) { e.preventDefault(); e.stopPropagation(); setSearch('nodes'); return }
      // chord buffer: a leader (n/d) holds, the next letter fires (CHORDS); a non-match or a 700ms lull clears it and falls through
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
        const cur = chordRef.current
        if (cur.buf || CHORD_LEADERS.has(e.key)) {
          clearTimeout(cur.timer)
          const buf = cur.buf + e.key
          if (CHORDS[buf]) { e.preventDefault(); e.stopPropagation(); chordRef.current = { buf: '', timer: 0 }; startNew(CHORDS[buf](focus.id)); return }
          if (CHORD_KEYS.some((c) => c.startsWith(buf))) {
            e.preventDefault(); e.stopPropagation()
            chordRef.current = { buf, timer: setTimeout(() => { chordRef.current = { buf: '', timer: 0 } }, 700) }
            return
          }
          chordRef.current = { buf: '', timer: 0 }   // dead end → reset, fall through to single-key handling
        }
      }
      // hjkl mirror the arrows for graph nav (vim): k/j up/down the column, h/l to parent/child.
      // Keys resolved through the registry (firesKey) so they stay the single source the legend/controller share.
      if (firesKey('nav.up', e.key))     return go(upTarget, e)
      if (firesKey('nav.down', e.key))   return go(downTarget, e)
      if (firesKey('nav.parent', e.key)) return go(parent, e)
      if (firesKey('nav.child', e.key))  return go(rightTarget, e)
      // zoom & cycle are keyboard board ops too — they engage kbdMode so the mouse steps aside the same way.
      if (firesKey('graph.zoomIn', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (firesKey('graph.zoomOut', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (firesKey('graph.zoomReset', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, 0.85, 200) }
      else if (firesKey('graph.info', e.key)) { e.preventDefault(); setOverlay(true) }
      // overlay cycle: o / O walk focus through changed nodes (scope follows the lock), wrapping
      else if (firesKey('graph.cycle', e.key) || firesKey('graph.cycleRev', e.key)) {
        e.preventDefault()
        if (!cycleNodes.length) return
        setKbdMode(true)
        const next = cycleNext(cycleNodes, focus.id, firesKey('graph.cycleRev', e.key) ? -1 : 1, (n) => n.id)
        if (next) setFocusId(next.id)
      }
      // Enter is folded into board.info above — from the graph it opens the node-info popup, the same as `i`;
      // crossing into an existing session is the right-click node-menu's job ([[node-menu]]), not a keystroke.
      // [-key (the [[node]] mention opener): jump to a
      // FRESH New Session on the focus ([[<id>]] pre-seeded), unconditional — never enters an existing session
      else if (firesKey('graph.fresh', e.key)) { e.preventDefault(); startNew(`[[${focus.id}]] `) }
      // f-key: open the Evals page ([[evals-view]]) — the leading loss surface — from the board; the rail is the other entry
      else if (firesKey('graph.evals', e.key)) { e.preventDefault(); navigate('evals') }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, page, legend, search, highlightId, focus, cycleNodes, upTarget, downTarget, rightTarget, parent, centerOn, getViewport, openSession, startNew, popupScroll, legendScroll])

  // wake only on a real coordinate change — a pan under a still cursor can emit a synthetic mousemove with unchanged x/y
  useEffect(() => {
    const onMove = (e) => {
      const p = lastMouseRef.current
      const moved = e.clientX !== p.x || e.clientY !== p.y
      p.x = e.clientX; p.y = e.clientY
      if (moved && kbdRef.current) setKbdMode(false)
    }
    window.addEventListener('mousemove', onMove, true)
    return () => window.removeEventListener('mousemove', onMove, true)
  }, [])

  // clicking a node focuses it — drilling it open the same way the arrows do — but the board STAYS put: the
  // camera follows the keyboard, not the mouse ([[keyboard-nav]]). We flag the follow effect to skip its
  // recenter so the click expands in place with no pan. It does NOT open a session — Enter crosses into one.
  const onNodeClick = useCallback((_e, n) => {
    if (n.id !== focusRef.current.id) skipCenterRef.current = true
    setFocusId(n.id)
  }, [])

  // double-click is the mouse parallel to the `i` key: focus the node AND open its info popup — still no pan
  // (mouse never moves the camera; only the keyboard does).
  const onNodeDoubleClick = useCallback((_e, n) => {
    if (n.id !== focusRef.current.id) skipCenterRef.current = true
    setFocusId(n.id); setOverlay(true)
  }, [])

  // right-click on a node: suppress the browser menu and open the node's own action menu ([[node-menu]]) —
  // focusing the node first (in place, no pan, same as click) so the menu and the board agree on the target.
  // Off-node right-clicks aren't handled here: the open menu closes ITSELF on any window contextmenu
  // (NodeContextMenu's capture listener), and the browser default stays available elsewhere.
  const onNodeContextMenu = useCallback((e, n) => {
    e.preventDefault()
    if (n.id !== focusRef.current.id) skipCenterRef.current = true
    setFocusId(n.id)
    setNodeMenu({ x: e.clientX, y: e.clientY, id: n.id })
  }, [])

  // clicking a session in the top-right window toggles the lock on its worktree's overlays (matched by
  // source = worktree path). Locking ON jumps to the first node it's changing, in TREE order so the
  // camera lands where the `o` cycle enters; focusing a collapsed id is fine (expand-on-focus drills its
  // spine open). A session with no pending ops still locks — the top banner explains the empty grip;
  // releasing (clicking again) leaves focus where it is.
  // toggle=true (the graph's session rows): a click on the locked session releases it. toggle=false (the
  // session-board tab's DOUBLE click): always GRIP — switch back to the graph already locked + focused,
  // never accidentally release. Either way, locking auto-focuses the session's first changed node.
  const onPickSession = useCallback((s, toggle = true) => {
    const releasing = toggle && highlightId === s.source
    setHighlightId(releasing ? null : s.source)
    if (releasing) return
    const ids = new Set((s.ops || []).map((op) => op.nodeId))
    const first = specs.find((n) => ids.has(n.id))
    if (first) setFocusId(first.id)
  }, [highlightId, specs])

  // the graph page's right column is user-resizable ([[resizable-panes]]): drag the divider, width persists.
  const [fpW, fpDrag] = useResizable('spex.fpWidth', 250, { min: 190, max: 520, dir: -1 })

  return (
    <div className={kbdMode ? 'app kbd-mode' : 'app'}>
      <TooltipLayer />
      <SideBar page={page} onNav={navigate} project={project} catalog={catalog} />
      <div className="app-main">
      <div className="page-graph" style={{ '--fp-w': `${fpW}px`, display: page === 'graph' ? undefined : 'none' }}>
      <div className="graph" ref={graphRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesFocusable={false}
          disableKeyboardA11y
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        />
        {/* HUD: brand + a discreet `?` that opens the keymap/legend modal */}
        <div className="hud">
          <span className="brand">$ {project || 'spec-dashboard'}</span>
          <button className="hud-help" onClick={() => setLegend((v) => !v)} data-tip={t('hud.helpTitle')}>?</button>
        </div>

        <SessionWindow sessions={sessions} activeId={highlightId} onPick={onPickSession} onOpenSession={openSession} />

        <GraphStats specs={specs} focusId={focusId} onJump={setFocusId} />

        <NodeContextMenu
          menu={nodeMenu} onClose={() => setNodeMenu(null)}
          onInfo={() => setOverlay(true)}
          onFresh={(id) => startNew(`[[${id}]] `)}
          onNewChild={(id) => startNew(CHORDS.nn(id))}
          onDelete={(id) => startNew(CHORDS.dd(id))}
          sessions={menuSessions}
          onOpenSession={openSession}
        />

        {lockedSession && (
          <div className="lock-hint" style={{ '--ov': labelColor(lockedSession.id) }}>
            <span className="lock-hint-lead"><LockGlyph /> {sessionHeadline(lockedSession)}</span>
            {lockedNodes.length ? (
              <span className="lock-hint-body">
                {showLockCycleKeys(lockedNodes.length) ? (
                  <>
                    {t('lockHint.cycleBefore')}<kbd>{lockCycleKeys.next}</kbd>{t('lockHint.cycleNext')}
                    <span className="lock-hint-sep"> / </span>
                    <kbd>{lockCycleKeys.prev}</kbd>{t('lockHint.cyclePrev')}{t('lockHint.cycleAfter', { n: lockedNodes.length })}
                  </>
                ) : t('lockHint.singleChanged')}
              </span>
            ) : (
              <span className="lock-hint-body">{t('lockHint.empty')}</span>
            )}
            <button className="lock-hint-release" onClick={() => setHighlightId(null)} data-tip={t('lockHint.releaseTitle')}>
              {t('lockHint.release')}
            </button>
          </div>
        )}

        {legend && <Legend onClose={() => setLegend(false)} />}
      </div>

      {/* the divider the focus panel hangs on — an 8px col-resize hit strip straddling the pane border */}
      <div className="pane-resizer" onMouseDown={fpDrag} role="separator" aria-orientation="vertical" />
      <FocusPanel node={focus} onNavigateAddress={onNavigateAddress} />
      </div>

      {/* key on focus.id: remount when the open overlay switches nodes, so the lazily-fetched body ([[graph-lean]])
          never renders one node's prose under another's header while the new fetch is in flight. */}
      {overlay && <NodeView key={focus.id} node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} />}
      {/* the console mounts immediately (warm terminals) — its chunk just arrives a beat after the shell;
          nothing renders in its place while it loads (it's hidden unless routed to anyway). */}
      <Suspense fallback={null}>
        <SessionInterface
          sessions={sessions}
          specs={specs}
          focusNode={focus}
          open={page === 'sessions'}
          searchOpen={!!search}
          sel={sessionSel}
          setSel={setSessionSel}
          seed={seed}
          onSeedConsumed={() => setSeed(null)}
          evalSeed={evalSeed}
          onEvalSeedConsumed={() => setEvalSeed(null)}
          onClose={() => navigate('graph')}
          onPickSession={onPickSession}
          onOpenSession={openSession}
          onOpenSearch={() => setSearch('sessions')}
          reload={reload}
        />
      </Suspense>
      {/* the Evals page ([[evals-view]]) — its own top-level route; the feed rides the app's board poll */}
      {page === 'evals' && (
        <div className="page-pane page-evals">
          <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
            <EvalsPage specs={specs} sessions={sessions} reloadBoard={reload} onOpenSession={openSession} />
          </Suspense>
        </div>
      )}
      {/* the Issues page ([[issues-view]]) — its own route; renders from the app-resident issues list */}
      {page === 'issues' && (
        <div className="page-pane page-issues">
          <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
            <IssuesPage specs={specs} sessions={sessions} issuesData={issuesData} reloadIssues={reloadIssues} issueId={param} onOpenSession={openSession} onFocusNode={(id) => { setFocusId(id); navigate('graph') }} />
          </Suspense>
        </div>
      )}
      {/* the settings page ([[settings]]) — same sections as ever, now a routed page instead of a popup */}
      {page === 'settings' && (
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
          <Settings />
        </Suspense>
      )}
      {/* the projects catalog ([[projects-hub]]) as a routed page inside a scoped dashboard — the same
          component the hub face mounts standalone; it fetches and gates itself. */}
      {page === 'projects' && (
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
          <ProjectsPage />
        </Suspense>
      )}
      {/* the one shared search palette ([[session-search]]) — mounted at APP level, not inside a
          routed page: it must float above whichever page is showing (the graph's `/`, the session board's
          ⌘+/ and Search pill), and a page's display:none must never swallow it. */}
      {search && <SpecSearch specs={specs} sessions={sessions} onPick={onSearchPick} onClose={() => setSearch(null)} boost={search === 'sessions' ? 'session' : null} />}
      </div>
    </div>
  )
}

// the desktop tree owns its own ReactFlowProvider (it used to sit in main.jsx): the provider is xyflow, and
// hoisting it above the mobile/desktop split would drag the whole graph library into the phone's entry chunk.
export default function DesktopDashboard(props) {
  return (
    <ReactFlowProvider>
      <Dashboard {...props} />
    </ReactFlowProvider>
  )
}
