import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, MarkerType, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { panesFor } from './NodeView.jsx'
import FocusPanel from './FocusPanel.jsx'
import SessionWindow, { LockGlyph } from './SessionWindow.jsx'
import SessionInterface from './SessionInterface.jsx'
import Legend from './Legend.jsx'
import Settings from './Settings.jsx'
import SpecSearch from './SpecSearch.jsx'
import BoardStats from './BoardStats.jsx'
import MobileApp from './MobileApp.jsx'
import { useIsMobile } from './useIsMobile.js'
import { loadBoard, layout, X_GAP, Y_GAP, projectTitle, projectIcon, faviconHref } from './data.js'
import { createMomentumScroll } from './scroll.js'
import { cycleNext } from './cycle.js'
import { firesKey } from './bindings.js'
import { returnFocus } from './focus.js'
import { labelColor } from './color.js'
import { sessionHeadline } from './session.js'
import { useT } from './i18n/index.jsx'

const nodeTypes = { spec: SpecNode }
// node box (used only to centre the camera on a node). NW/NH must track the .spec-node size in
// styles.css: it's now two rows (title line + editor/last-edited line) and a bit wider for longer titles.
const NW = 220, NH = 46
const clamp = (z) => Math.max(0.4, Math.min(1.6, z))

// nn = new child under focus, dd = delete focus; leaders n/d are unbound on the board so single-key nav isn't shadowed
const CHORDS = { nn: (id) => `@new under @${id}: `, dd: (id) => `@delete @${id}: ` }
const CHORD_KEYS = Object.keys(CHORDS)
const CHORD_LEADERS = new Set(CHORD_KEYS.map((c) => c[0]))

function Dashboard({ specs, sessions, reload }) {
  const [focusId, setFocusId] = useState(() => specs.find((s) => !s.parent)?.id)
  const [overlay, setOverlay] = useState(false)   // node-info popup (opened by `i`)
  const [pane, setPane] = useState('spec')
  const [sessionUI, setSessionUI] = useState(false) // session interface (opened by Enter)
  const [legend, setLegend] = useState(false)     // centered help modal: keymap + visual vocabulary (`?`)
  const [settings, setSettings] = useState(false) // centered settings modal: language picker etc. (`,`)
  const [search, setSearch] = useState(null)      // search palette mode: null | 'board' (`/`, nodes lead) | 'sessions' (⌘/Ctrl+/, sessions lead)
  const [sessionSel, setSessionSel] = useState('new') // persisted across open/close: last tab/session
  const [highlightId, setHighlightId] = useState(null) // session whose overlays are emphasised
  const [seed, setSeed] = useState(null)          // one-shot text a board chord pre-fills the New Session input with
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

  const liveEditorsOf = useCallback(
    (node) => (node ? sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id)) : []),
    [sessions],
  )

  const openBoard = useCallback(() => setSessionUI(true), [])
  const openEval = useCallback(() => { setPane('eval'); setOverlay(true) }, [])
  const openSession = useCallback((id) => { setSessionSel(id); setSessionUI(true) }, [])
  const startNew = useCallback((text) => { setSessionSel('new'); setSeed(text); setSessionUI(true) }, [])
  // one routing for BOTH palettes (board `/` and session-board ⌘/Ctrl+/): a session opens/switches to its
  // tab; a non-session closes the session view (a no-op when already on the board) and jumps to the node on
  // the graph. The select-target branch is shared, not forked — only the lead weight differs by entry point.
  const onSearchPick = useCallback((e) => {
    if (e.kind === 'session') openSession(e.target)
    else { setSessionUI(false); setFocusId(e.target) }
  }, [openSession])

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

  // center the root once after first paint; thereafter the follow effect owns the camera
  const framedRef = useRef(false)
  useEffect(() => {
    if (framedRef.current) return
    framedRef.current = true
    const id = requestAnimationFrame(() => centerOn(focus, undefined, 0))
    return () => cancelAnimationFrame(id)
  }, [centerOn, focus])

  // The camera follows the KEYBOARD, not the mouse ([[keyboard-nav]]): a keyboard or programmatic focus move
  // pans to recenter the new focus; a mouse click expands in place and the board STAYS. Node positions are a
  // fixed structural embedding — a node's x/y depends only on tree shape, never on which node is focused — so a
  // click's expand shifts nothing already on screen; only the camera would move, and that's the keyboard's alone.
  // Fires on focusId alone (not the poll); reads latest focus/centerOn via refs; skips the first paint.
  const focusRef = useRef(focus); focusRef.current = focus
  const centerRef = useRef(centerOn); centerRef.current = centerOn
  const followedRef = useRef(false)
  const skipCenterRef = useRef(false)   // a mouse click sets this so the follow effect leaves the board where it is
  useEffect(() => {
    if (!followedRef.current) { followedRef.current = true; return }
    if (skipCenterRef.current) { skipCenterRef.current = false; return }   // mouse-click focus move: no pan
    centerRef.current(focusRef.current)
  }, [focusId])

  // focus-return boundary ([[focus-return]]): a transient overlay (search / help / settings / node popup)
  // takes focus when it opens; when the LAST one closes, hand focus back to whoever held it — else the
  // docked sink. Never <body>. The session interface is a surface with its own focus discipline (it hosts
  // the sink), not a transient overlay, so it stays out of this set.
  const anyOverlay = overlay || legend || settings || !!search
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
      if (sessionUI) return // the session interface owns ALL its keys (arrows / Enter / typing / Esc / the graph)
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
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
        // Enter crosses from reading the node to the session board (at the remembered tab). Popup closes behind.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOverlay(false); openBoard(); return }
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
      if (firesKey('board.help', e.key)) { e.preventDefault(); setLegend(true); return }
      // settings modal owns its keys while open (only ,/Esc close it)
      if (settings) {
        if (e.key === 'Escape' || e.key === ',') { e.preventDefault(); setSettings(false); return }
        return
      }
      if (e.key === 'Escape' && highlightId) { e.preventDefault(); e.stopPropagation(); setHighlightId(null); return }
      if (firesKey('board.settings', e.key)) { e.preventDefault(); setSettings(true); return }
      if (firesKey('board.search', e.key)) { e.preventDefault(); e.stopPropagation(); setSearch('board'); return }
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
      if (firesKey('board.zoomIn', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (firesKey('board.zoomOut', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (firesKey('board.zoomReset', e.key)) { e.preventDefault(); setKbdMode(true); centerOn(focus, 0.85, 200) }
      else if (firesKey('board.info', e.key)) { e.preventDefault(); setOverlay(true) }
      // overlay cycle: o / O walk focus through changed nodes (scope follows the lock), wrapping
      else if (firesKey('board.cycle', e.key) || firesKey('board.cycleRev', e.key)) {
        e.preventDefault()
        if (!cycleNodes.length) return
        setKbdMode(true)
        const next = cycleNext(cycleNodes, focus.id, firesKey('board.cycleRev', e.key) ? -1 : 1, (n) => n.id)
        if (next) setFocusId(next.id)
      }
      // Enter opens the session board at the remembered tab (boarding switch — see openBoard).
      else if (firesKey('board.enter', e.key)) { e.preventDefault(); openBoard() }
      // @-key: jump to a FRESH New Session on the focus (@<id> pre-seeded), unconditional — never enters an existing session
      else if (firesKey('board.fresh', e.key)) { e.preventDefault(); startNew(`@${focus.id} `) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, sessionUI, legend, settings, search, highlightId, focus, cycleNodes, upTarget, downTarget, rightTarget, parent, centerOn, getViewport, openBoard, startNew, popupScroll, legendScroll])

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

  return (
    <div className={kbdMode ? 'app kbd-mode' : 'app'}>
      <div className="graph" ref={graphRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesFocusable={false}
          disableKeyboardA11y
          defaultViewport={{ x: 0, y: 0, zoom: 0.85 }}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
        </ReactFlow>
        {/* HUD: brand + a discreet `?` that opens the keymap/legend modal */}
        <div className="hud">
          <span className="brand">$ spec-dashboard</span>
          <button className="hud-help" onClick={() => setLegend((v) => !v)} title={t('hud.helpTitle')}>?</button>
        </div>

        <SessionWindow sessions={sessions} activeId={highlightId} onPick={onPickSession} onOpenSession={openSession} />

        <BoardStats specs={specs} focusId={focusId} onJump={setFocusId} />

        {lockedSession && (
          <div className="lock-hint" style={{ '--ov': labelColor(lockedSession.id) }}>
            <span className="lock-hint-lead"><LockGlyph /> {sessionHeadline(lockedSession)}</span>
            {lockedNodes.length ? (
              <span className="lock-hint-body">
                {t('lockHint.cycleBefore')}<kbd>o</kbd><kbd>O</kbd>{t('lockHint.cycleAfter', { n: lockedNodes.length })}
              </span>
            ) : (
              <span className="lock-hint-body">{t('lockHint.empty')}</span>
            )}
            <button className="lock-hint-release" onClick={() => setHighlightId(null)} title={t('lockHint.releaseTitle')}>
              {t('lockHint.release')}
            </button>
          </div>
        )}

        {legend && <Legend onClose={() => setLegend(false)} />}
        {settings && <Settings onClose={() => setSettings(false)} />}
        {search && <SpecSearch specs={specs} sessions={sessions} onPick={onSearchPick} onClose={() => setSearch(null)} boost={search === 'sessions' ? 'session' : null} />}
      </div>

      <FocusPanel node={focus} onOpenEval={openEval} />

      {overlay && <NodeView node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} />}
      <SessionInterface
        sessions={sessions}
        specs={specs}
        focusNode={focus}
        open={sessionUI}
        searchOpen={!!search}
        sel={sessionSel}
        setSel={setSessionSel}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
        onClose={() => setSessionUI(false)}
        onPickSession={onPickSession}
        reload={reload}
      />
    </div>
  )
}

export default function App() {
  const t = useT()
  const isMobile = useIsMobile()
  const [board, setBoard] = useState(null)
  // freshest-issued wins: stamp each load with a monotonic seq and apply only the latest, so a stale in-flight poll can't resurrect removed state
  const reqSeq = useRef(0)
  const reload = useCallback(() => {
    const mine = ++reqSeq.current
    return loadBoard().then((b) => { if (mine === reqSeq.current) setBoard(b) }).catch(() => {})
  }, [])
  useEffect(() => {
    reload()
    const id = setInterval(reload, 4000)
    return () => clearInterval(id)
  }, [reload])
  useEffect(() => {
    const name = projectTitle(board)
    if (name) document.title = `${name} · SpexCode`
  }, [board?.project])
  useEffect(() => {
    // [[tab-icon]] - a configured dashboard.icon sets the tab favicon at runtime; empty keeps the html default.
    const href = faviconHref(projectIcon(board))
    if (!href) return
    let link = document.querySelector("link[rel~='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    link.setAttribute('href', href)
  }, [board?.projectIcon])
  if (!board) return <div className="loading">{t('hud.loading')}</div>
  if (isMobile) return <MobileApp specs={board.nodes} sessions={board.sessions} project={projectTitle(board)} />
  return <Dashboard specs={board.nodes} sessions={board.sessions} reload={reload} />
}
