import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, MarkerType, Position, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeContextMenu from './NodeContextMenu.jsx'
import NodeView, { panesFor } from './NodeView.jsx'
import { LockGlyph } from './SessionWindow.jsx'
import Legend from './Legend.jsx'
import GraphStats from './GraphStats.jsx'
import PublicGraphAbout from './PublicGraphAbout.jsx'
import { useRoute, navigate } from './route.js'
import { pinTab } from './tabs.js'
import { navigateAddress } from './address.js'
import { layout, X_GAP, Y_GAP } from './data.js'
import { createMomentumScroll } from './scroll.js'
import { cycleNext } from './cycle.js'
import { firesKey, keysOf } from './bindings.js'
import { useKeyboardScope } from './KeyboardService.jsx'
import { returnFocus } from './focus.js'
import { labelColor } from './color.js'
import { sessionHeadline } from './session.js'
import { lockCycleKeyLabels, showLockCycleKeys } from './lockHint.js'
import { useT } from './i18n/index.jsx'
import { useBoard, useBoardApi, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { useStatusItem } from './StatusBar.jsx'
import { encodeCodeSelection } from './codeSelection.js'

// code-split the heavy leaves off the desktop entry chunk: the session console drags in xterm (+addons),
// the evals/issues pages the video annotator — none of which the first graph paint needs. SessionInterface
// still MOUNTS immediately (warm terminals — its chunk is fetched right after the shell paints); the routed
// pages fetch on first visit.
const SessionInterface = lazy(() => import('./SessionInterface.jsx'))
const EvalsPage = lazy(() => import('./EvalsPage.jsx'))
const IssuesPage = lazy(() => import('./IssuesPage.jsx'))
const Settings = lazy(() => import('./Settings.jsx'))

const nodeTypes = { spec: SpecNode }
// Layout coordinates name the node centre. Initial dimensions let React Flow place a new fixed-format tile
// and its edges on the first render instead of painting one unmeasured frame before its ResizeObserver fires.
const NODE_ORIGIN = [0.5, 0.5]
const NODE_SIZE = { width: 176, height: 50 }
const NODE_HANDLES = [
  { type: 'target', position: Position.Left, x: -1.5, y: 22.5, width: 5, height: 5 },
  { type: 'source', position: Position.Right, x: 172.5, y: 22.5, width: 5, height: 5 },
]
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

// ONE page boundary ([[side-nav]]): every routed page renders inside the same pane with the same loading
// fallback — a page whose lazy chunk is still arriving shows the shared loading state in place, never a
// blank main area, and no loading intermediate touches the document head or unmounts the shell. `warm`
// pages (the graph's camera, the session console's terminals) stay mounted and display-toggle instead of
// unmounting — a property any page may claim, never a session-board special case.
function PagePane({ active, warm = false, className, children }) {
  const t = useT()
  if (!warm && !active) return null
  return (
    <div className={className ? `page-pane ${className}` : 'page-pane'} style={active ? undefined : { display: 'none' }}>
      <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>{children}</Suspense>
    </div>
  )
}

function GraphView({ param, query }) {
  const { specs, sessions, boardLive, identity, graphOnly } = useBoard()
  const { reload } = useBoardApi()
  const { openPalette, setCompose, lockGraphTo } = useWorkspaceApi()
  // WHICH SESSION OWNS THE BOARD lives in the workspace ([[workspace-shell]]) because the surface that
  // claims it — a session row in the finding dock — is not this one. The graph only READS the claim and
  // paints it; it no longer needs a session list of its own to have somewhere to click.
  const { lockedSource: highlightId } = useWorkspace()
  const project = identity?.title || ''
  // the URL is the page switch ([[side-nav]]): #/graph[/<node>] | #/sessions[/<sel>] | #/issues | #/settings.
  // `page` replaces the old boolean overlay states (sessionUI / settings-modal) — the sidebar, the keyboard,
  // and the address bar all drive the same route.
  const page = 'graph'
  useEffect(() => {
  }, [graphOnly, page])
  // SessionInterface owns live terminals, so it stays mounted after the first visit. Do not eagerly mount
  // it on graph/evals/issues routes: a cold dashboard should not open every session transport just because
  // the console is available as a sibling route.
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
  const search = null   // the palette is the shell's ([[workspace-shell]]); the graph only asks for it
  const setSeed = setCompose   // a board chord hands text to the sessions view through the workspace
  const [nodeMenu, setNodeMenu] = useState(null)  // node right-click menu: { x, y, id } | null ([[node-menu]])
  const { getViewport, setViewport } = useReactFlow()
  const t = useT()
  // the `?` legend is the GRAPH's keymap, so the graph contributes it and it leaves the bar when the graph
  // does. The project name is workspace identity and belongs to the shell — splitting them was the first
  // thing the view boundary made obvious. `-Infinity` pins help to the far end.
  useStatusItem({ id: 'help', side: 'left', priority: -Infinity, text: '?', tooltip: t('hud.helpTitle'), onClick: () => setLegend((v) => !v) })
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
  // A graph-node address is a shareable focus target. Apply each changed route parameter before paint; an
  // already-applied parameter must not reassert itself after an ordinary mouse or keyboard focus move.
  const graphParamRef = useRef(null)
  useLayoutEffect(() => {
    if (page !== 'graph' || graphParamRef.current === param) return
    graphParamRef.current = param
    if (param && rawById[param]) setFocusId(param)
  }, [page, param, rawById])
  const focusNode = useCallback((id) => {
    if (!id) return
    setFocusId(id)
  }, [])
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

  const openSession = useCallback((id) => navigate('sessions', id), [])
  const startNew = useCallback((text) => { setSeed(text); navigate('sessions', 'new') }, [setSeed])
  const startFromSelection = useCallback((selection) => {
    startNew(encodeCodeSelection(selection))
  }, [startNew])
  const onNavigateAddress = useCallback((address) => {
    navigateAddress(address, { onOpenSession: openSession })
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
  // one routing for BOTH palettes (board `/` and session-board ⌥+/): each row carries an app address
  // (graph node, session tab, issue detail, or eval detail). The palette's caller supplies only the view
  // callbacks needed for non-hash state; the address helper owns the route shape.
  const onSearchPick = useCallback((e) => {
    onNavigateAddress(e.address)
  }, [onNavigateAddress])

  // sel ↔ URL, two one-way syncs that converge: a deep-linked / history-walked `#/sessions/<sel>` applies
  // its param to the selection; a selection made in the UI is ECHOED into the hash with replace (the tab
  // echo is automatic state-naming — pages and details push, see route.js). The legacy
  // `#/sessions/<id>/eval[/…]` shape never reaches here — the route layer normalizes it to the Evals
  // family ([[session-eval]]) before any parse lands.


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
    const extra = {
      editors: editorData,
      collapsed: kids > 0 && !expanded.has(s.id),
      childCount: kids,
    }
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y },
      data: { ...s, ...extra },
      initialWidth: NODE_SIZE.width, initialHeight: NODE_SIZE.height,
      handles: NODE_HANDLES,
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

  // Flat-pan the viewport without moving graph-space node/edge geometry.
  const animateView = useCallback((target, dur) => {
    const start = getViewport()
    const t0 = performance.now()
    cancelAnimationFrame(animRef.current)
    const step = (now) => {
      const p = dur ? Math.min(1, (now - t0) / dur) : 1
      const eased = 1 - Math.pow(1 - p, 3)
      setViewport({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
        zoom: start.zoom + (target.zoom - start.zoom) * eased,
      })
      if (p < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
  }, [getViewport, setViewport])

  // Frame a node at the graph pane's geometric centre; when zoom is omitted the current zoom is reused.
  const centerOn = useCallback((node, zoom, dur = 300) => {
    const el = graphRef.current
    if (!el) return
    const z = zoom ?? getViewport().zoom
    animateView({ x: el.clientWidth / 2 - node.x * z, y: el.clientHeight / 2 - node.y * z, zoom: z }, dur)
  }, [animateView, getViewport])

  // Frame the root once after the graph page's first VISIBLE paint; thereafter the follow effect owns the
  // camera. Gated on the route: a deep-load on another page keeps the graph hidden (zero-sized), so framing
  // waits for the first visit instead of measuring a display:none container.
  const framedRef = useRef(false)
  useEffect(() => {
    if (framedRef.current || page !== 'graph') return
    const id = requestAnimationFrame(() => {
      framedRef.current = true
      centerOn(focus, undefined, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [centerOn, focus, page])

  // The camera follows the KEYBOARD, not the mouse ([[keyboard-nav]]): a keyboard or programmatic focus move
  // pans to frame the new focus; a mouse click expands in place and the board STAYS. Node positions are a
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

  // Register the graph's active-view vocabulary with the shell service; the shell owns the only window listener.
  useKeyboardScope((event) => {
    // the focused node's actual tabs (panesFor), so pane-nav matches what NodeView renders for THIS node
    const paneKeys = panesFor(focus, graphOnly).map((p) => p.key)
    const cyclePane = (dir) => setPane((p) => { const i = paneKeys.indexOf(p); return paneKeys[((i < 0 ? 0 : i) + dir + paneKeys.length) % paneKeys.length] })
    // nav just moves focus; the follow-focus effect recenters once the tree has re-plotted around the new
    // focus (passing the stale pre-re-plot node straight to centerOn would aim at its OLD coordinates).
    const go = (t, e) => { if (!t) return false; e.preventDefault(); e.stopPropagation(); setKbdMode(true); focusNode(t.id); return true }
    // only one pane is mounted, so the first matching `.ov-body` descendant is the scroller (scroll.js drops a stale target)
    const bumpScroll = (delta) => popupScroll(
      document.querySelector('.ov-body .pane-doc, .ov-body .pane-hist, .ov-body .pane-issues, .ov-body .pane-eval, .ov-body .pane-edit'), delta)
    const onKey = (e) => {
      // The search palette is a modal: while open it owns its keys over ANY surface — the board OR the session
      // interface (the session interface yields via its searchOpen guard). The SpecSearch input owns ↑/↓/Enter/
      // typing; App only catches Esc here so it closes even if the input blurred. This guard sits ABOVE the
      // sessionUI return so it holds when the palette is opened over the session board.
      if (search) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); openPalette(null) }
        return e.key === 'Escape'
      }
      // Everything below is the plain-key board vocabulary. Browser/system accelerators that happen to use
      // the same base key (`Ctrl/⌘+L`, `Ctrl/⌘+,`, `Alt+←`, …) pass through unless declared above.
      if (e.metaKey || e.ctrlKey || e.altKey) return false
      // A focused native control owns its activation keys: Enter/Space on a button, link, or form field is
      // that control's click — tabbing to the HUD `?` and pressing Enter must equal clicking it — so the
      // board vocabulary (board.info's Enter alias included) steps aside and lets the default action fire.
      // Graph tiles never collide: nodesFocusable is off, so board focus is never DOM focus on a control.
      if ((e.key === 'Enter' || e.key === ' ') && e.target?.closest?.('button, a[href], input, select, textarea, summary')) return false
      if (page === 'sessions') return false // the session interface owns ALL its keys (arrows / Enter / typing / Esc / the graph)
      // the Evals and Issues pages own their own keys (j/k list-walk, their inputs, their own Esc stack) —
      // EvalsPage / IssuesPage handle them. Esc does NOT route pages anywhere ([[side-nav]]) — leaving is
      // ⌥1..⌥5, the rail, or history.
      if (page === 'evals' || page === 'issues') return false
      // the settings page: `,` toggles back home; typing inside its shortcut-capture stays its own
      if (page === 'settings') {
        if (firesKey('graph.settings', e.key)) { e.preventDefault(); e.stopPropagation(); navigate('graph'); return true }
        return false
      }
      if (overlay) {
        // a focused form field, an OPEN MENU, or a menu TRIGGER inside the popup owns its unmodified keys
        // ([[keyboard-nav]]'s native-control restraint, extended for the embedded review filters): typing
        // (h/j/l/digits), caret arrows, menu roving, and ArrowDown-to-open must never become pane switches
        // or scrolls. Escape still falls through — the esc stack peels the menu first, then this branch
        // closes the popup. Scoped to controls INSIDE the popup: stray DOM focus on a control elsewhere
        // (the rail's project chip is also [aria-haspopup]) must not swallow the popup's j/k.
        const keyOwner = e.key === 'Escape' ? null : e.target?.closest?.('input, textarea, select, [role="menu"], [role="menuitemradio"], [aria-haspopup="menu"]')
        if (keyOwner?.closest('[data-focus-overlay]')) return false
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return true }
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
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return true }
        // ←/→ or h/l cycle the panes (like Tab and 1/2)
        if (e.key === 'ArrowLeft'  || e.key === 'h') { e.preventDefault(); e.stopPropagation(); cyclePane(-1); return true }
        if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); e.stopPropagation(); cyclePane(1); return true }
        if (/^[1-9]$/.test(e.key) && +e.key <= paneKeys.length) { e.preventDefault(); e.stopPropagation(); setPane(paneKeys[+e.key - 1]); return true }
        // j/k and ↑/↓ scroll the open pane; in the history pane reaching the end also reveals the next version (see HistoryPane)
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          bumpScroll(e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return true
        }
        // Enter is INERT here: the info popup is a pure reading surface, not a launchpad. Crossing into
        // the node's live session is a right-click node-menu action ([[node-menu]]), never a keystroke —
        // so Enter (like any other key) is swallowed and does nothing, leaving the popup open.
        return true // anything else does NOT move the board behind the popup
      }
      // graph mode. The help modal owns its keys while open (only ?/Esc close it)
      if (legend) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setLegend(false); return true }
        // j/k and ↑/↓ scroll the (often taller-than-viewport) help body — same momentum glide as the
        // popup pane, via the legend's own scroller instance. The `.legend` panel is the overflow box.
        if (e.key === 'j' || e.key === 'k' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation()
          legendScroll(document.querySelector('.legend'), e.key === 'j' || e.key === 'ArrowDown' ? 120 : -120)
          return true
        }
        return true
      }
      if (firesKey('graph.help', e.key)) { e.preventDefault(); setLegend(true); return true }
      if (e.key === 'Escape' && highlightId) { e.preventDefault(); e.stopPropagation(); lockGraphTo(null, { toggle: false }); return true }
      if (!graphOnly && firesKey('graph.settings', e.key)) { e.preventDefault(); navigate('settings'); return true }
      if (!graphOnly && firesKey('graph.search', e.key)) { e.preventDefault(); e.stopPropagation(); openPalette('nodes'); return true }
      // chord buffer: a leader (n/d) holds, the next letter fires (CHORDS); a non-match or a 700ms lull clears it and falls through
      if (!graphOnly && !e.metaKey && !e.ctrlKey && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
        const cur = chordRef.current
        if (cur.buf || CHORD_LEADERS.has(e.key)) {
          clearTimeout(cur.timer)
          const buf = cur.buf + e.key
          if (CHORDS[buf]) { e.preventDefault(); e.stopPropagation(); chordRef.current = { buf: '', timer: 0 }; startNew(CHORDS[buf](focus.id)); return true }
          if (CHORD_KEYS.some((c) => c.startsWith(buf))) {
            e.preventDefault(); e.stopPropagation()
            chordRef.current = { buf, timer: setTimeout(() => { chordRef.current = { buf: '', timer: 0 } }, 700) }
            return true
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
      if (firesKey('graph.zoomIn', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom * 1.2), 160); return true }
      else if (firesKey('graph.zoomOut', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom / 1.2), 160); return true }
      else if (firesKey('graph.zoomReset', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, 0.85, 200); return true }
      else if (firesKey('graph.info', e.key)) { e.preventDefault(); setOverlay(true); return true }
      // overlay cycle: o / O walk focus through changed nodes (scope follows the lock), wrapping
      else if (firesKey('graph.cycle', e.key) || firesKey('graph.cycleRev', e.key)) {
        e.preventDefault()
        if (!cycleNodes.length) return true
        setKbdMode(true)
        const next = cycleNext(cycleNodes, focus.id, firesKey('graph.cycleRev', e.key) ? -1 : 1, (n) => n.id)
        if (next) focusNode(next.id)
        return true
      }
      // Enter is folded into board.info above — from the graph it opens the node-info popup, the same as `i`;
      // crossing into an existing session is the right-click node-menu's job ([[node-menu]]), not a keystroke.
      // [-key (the [[node]] mention opener): jump to a
      // FRESH New Session on the focus ([[<id>]] pre-seeded), unconditional — never enters an existing session
      else if (!graphOnly && firesKey('graph.fresh', e.key)) { e.preventDefault(); startNew(`[[${focus.id}]] `); return true }
      // f-key: open the Evals page ([[evals-view]]) — the leading loss surface — from the board; the rail is the other entry
      else if (!graphOnly && firesKey('graph.evals', e.key)) { e.preventDefault(); navigate('evals'); return true }
      return false
    }
    return onKey(event)
  })

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
    focusNode(n.id)
  }, [focusNode])

  // double-click is the mouse parallel to `i`: OPEN the node as a document. Single click still only
  // focuses, so the board stays a board — the gesture that means "I want to read this" is the one that
  // leaves it.
  const onNodeDoubleClick = useCallback((e, n) => {
    if (n.id !== focusRef.current.id) skipCenterRef.current = true
    focusNode(n.id)
    // The sealed public face has no document area — the popup IS its reading surface, so the gesture
    // keeps its old meaning there.
    if (graphOnly) setOverlay(true)
    else pinTab('spec', n.id)
  }, [focusNode, graphOnly])

  // right-click on a node: suppress the browser menu and open the node's own action menu ([[node-menu]]) —
  // focusing the node first (in place, no pan, same as click) so the menu and the board agree on the target.
  // Off-node right-clicks aren't handled here: the open menu closes ITSELF on any window contextmenu
  // (NodeContextMenu's capture listener), and the browser default stays available elsewhere.
  const onNodeContextMenu = useCallback((e, n) => {
    e.preventDefault()
    if (n.id !== focusRef.current.id) skipCenterRef.current = true
    focusNode(n.id)
    setNodeMenu({ x: e.clientX, y: e.clientY, id: n.id })
  }, [focusNode])

  // clicking a session in the top-right window toggles the lock on its worktree's overlays (matched by
  // source = worktree path). Locking ON jumps to the first node it's changing, in TREE order so the
  // camera lands where the `o` cycle enters; focusing a collapsed id is fine (expand-on-focus drills its
  // spine open). A session with no pending ops still locks — the top banner explains the empty grip;
  // releasing (clicking again) leaves focus where it is.
  // toggle=true (the graph's session rows): a click on the locked session releases it. toggle=false (the
  // session-board row's context-menu action): always GRIP — switch back to the graph already locked + focused,
  // never accidentally release. Either way, locking auto-focuses the session's first changed node.
  return (
    <div className={kbdMode ? 'graphview kbd-mode' : 'graphview'}>

      <div className="graph" ref={graphRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={graphOnly ? undefined : onNodeContextMenu}
          nodeOrigin={NODE_ORIGIN}
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
        <GraphStats specs={specs} focusId={focusId} onJump={focusNode} />

        {graphOnly && <PublicGraphAbout />}

        {!graphOnly && <NodeContextMenu
          menu={nodeMenu} onClose={() => setNodeMenu(null)}
          onInfo={() => navigate('spec', focusRef.current.id)}
          onFresh={(id) => startNew(`[[${id}]] `)}
          onNewChild={(id) => startNew(CHORDS.nn(id))}
          onDelete={(id) => startNew(CHORDS.dd(id))}
          sessions={menuSessions}
          onOpenSession={openSession}
        />}

        {!graphOnly && lockedSession && (
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
            <button className="lock-hint-release" onClick={() => lockGraphTo(null, { toggle: false })} data-tip={t('lockHint.releaseTitle')}>
              {t('lockHint.release')}
            </button>
          </div>
        )}

        {legend && <Legend onClose={() => setLegend(false)} />}

        {/* the `i`/Enter lens ([[node-popup]]): follows the focus, remounts per node. The surgery that
            extracted this view once dropped this line entirely while keeping all its key handling — a
            popup with working keys and no body. */}
        {overlay && <NodeView key={focus.id} node={focus} pane={pane} setPane={setPane} sessions={sessions} graphOnly={graphOnly}
          onSelection={graphOnly ? undefined : startFromSelection} onClose={() => setOverlay(false)} />}
      </div>
    </div>
  )
}

// the graph owns its own ReactFlowProvider: the provider is xyflow, and hoisting it into the shell would
// drag the whole graph library into every face's entry chunk, including the phone's and the sealed public
// build's. A view paying for its own library is the point of the registry being lazy.
export default function GraphViewRoot(props) {
  return (
    <ReactFlowProvider>
      <GraphView {...props} />
    </ReactFlowProvider>
  )
}
