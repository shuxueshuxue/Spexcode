import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, MarkerType, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { PANES } from './NodeView.jsx'
import SessionWindow from './SessionWindow.jsx'
import SessionInterface from './SessionInterface.jsx'
import Legend from './Legend.jsx'
import { loadBoard } from './data.js'

const nodeTypes = { spec: SpecNode }
const NW = 180, NH = 26
const PANE_KEYS = PANES.map((p) => p.key)
const clamp = (z) => Math.max(0.4, Math.min(1.6, z))

function Dashboard({ specs, sessions, reload }) {
  const [focusId, setFocusId] = useState(() => specs.find((s) => !s.parent)?.id)
  const [overlay, setOverlay] = useState(false)   // node-info popup (opened by `i`)
  const [pane, setPane] = useState('spec')
  const [sessionUI, setSessionUI] = useState(false) // session interface (opened by Enter)
  const [legend, setLegend] = useState(false)     // floating visual-vocabulary card (toggled by `?`)
  const [sessionSel, setSessionSel] = useState('new') // persisted across open/close: last tab/session
  const [highlightId, setHighlightId] = useState(null) // session whose overlays are emphasised
  const { getViewport, setViewport } = useReactFlow()
  const graphRef = useRef(null)
  const animRef = useRef(0)

  const byId = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  // focus is resilient to the board reflowing under polling (a merged/closed node may vanish).
  const focus = byId[focusId] || specs.find((s) => !s.parent) || specs[0]

  // @@@ node<->session link - a node does NOT belong to a session. `node.session` is only the LAST
  // editor (the git Session: trailer — usually a closed session), kept purely as attribution. The LIVE
  // link is the overlay: the board sessions CURRENTLY editing this node = those whose pending ops touch
  // it. That set (not node.session) is what we light up and jump into; a node can have 0, 1, or many.
  const liveEditorsOf = useCallback(
    (node) => (node ? sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id)) : []),
    [sessions],
  )

  const children = useMemo(() => specs.filter((s) => s.parent === focus.id), [specs, focus])
  const parent = focus.parent ? byId[focus.parent] : null

  // child is to the RIGHT; pick the one nearest in y.
  const childTarget = useMemo(() => {
    if (!children.length) return null
    return children.reduce((best, c) => (Math.abs(c.y - focus.y) < Math.abs(best.y - focus.y) ? c : best))
  }, [children, focus])

  // @@@ vertical nav - columns are aligned by depth (x = depth * X_GAP), so ↑/↓ move strictly
  // within the focused node's column to the nearest node in that y-direction. They never change
  // column or dive into a child (that's what ←/→ are for): on a border node, up jumps to the
  // cousin above in the SAME column, not to a nearer node one column over. Trivially reversible.
  const nearestY = useCallback((dir) => {
    let best = null
    for (const s of specs) {
      if (s.id === focus.id || s.x !== focus.x) continue
      const dy = s.y - focus.y
      if (dir === 'down' ? dy <= 0 : dy >= 0) continue
      if (!best || Math.abs(dy) < Math.abs(best.y - focus.y)) best = s
    }
    return best
  }, [specs, focus])
  const downTarget = useMemo(() => nearestY('down'), [nearestY])
  const upTarget    = useMemo(() => nearestY('up'), [nearestY])

  // @@@ nodes - positions from data; selection + (a) focus-kin dimming, or (b) when a session is
  // highlighted, the overlay-dim: nodes touched by that session glow, the rest fade. Recomputes on
  // poll (specs identity changes) so a freshly-added ghost shows up without a manual refresh.
  const nodes = useMemo(() => specs.map((s) => {
    const kin = s.id === focusId || s.id === focus.parent || s.parent === focusId || s.parent === focus.parent
    let className
    if (highlightId) {
      className = (s.overlays || []).some((o) => o.source === highlightId) ? 'ov-hot' : 'ov-dim'
    } else {
      className = kin ? undefined : 'is-far'
    }
    // a node with live editor(s) carries a `link` so SpecNode stamps the subtle ⏎ affordance — Enter
    // here crosses into that live session. Driven by the live overlay (pending ops), NOT node.session.
    const editors = liveEditorsOf(s)
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y },
      data: editors.length ? { ...s, link: { color: editors[0].color, status: editors[0].status } } : s,
      draggable: false, selected: s.id === focusId, className,
    }
  }), [focusId, focus.parent, highlightId, specs, liveEditorsOf])

  const edges = useMemo(() => {
    const tree = specs.filter((s) => s.parent).map((s) => {
      const hot = s.id === focusId || s.parent === focusId
      return {
        id: `${s.parent}-${s.id}`, source: s.parent, target: s.id, type: 'smoothstep',
        style: { stroke: hot ? '#268bd2' : '#ded7bf', strokeWidth: hot ? 2 : 1 }, zIndex: hot ? 1 : 0,
      }
    })
    // @@@ reparent preview - a node with a `moved` overlay carrying `toParent` (its proposed new parent)
    // gets a faint dashed arrow node→toParent in the author session's colour, so a human SEES the
    // reparent before it merges. Subtle (low opacity, animated dashes) and never touches a tree edge.
    const moves = []
    for (const s of specs) {
      const mv = (s.overlays || []).find((o) => o.op === 'moved' && o.toParent && byId[o.toParent])
      if (!mv) continue
      moves.push({
        id: `move-${s.id}-${mv.toParent}`, source: s.id, target: mv.toParent, type: 'smoothstep',
        animated: true, zIndex: 2, className: 'move-edge',
        style: { stroke: mv.color, strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.6 },
        markerEnd: { type: MarkerType.ArrowClosed, color: mv.color, width: 14, height: 14 },
      })
    }
    return [...tree, ...moves]
  }, [focusId, specs, byId])

  // camera — tree is fixed; viewpoint flat-pans to centre the focused node.
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

  const centerOn = useCallback((node, zoom, dur = 300) => {
    const el = graphRef.current
    if (!el) return
    const z = zoom ?? getViewport().zoom
    animateView({ x: el.clientWidth / 2 - (node.x + NW / 2) * z, y: el.clientHeight / 2 - (node.y + NH / 2) * z, zoom: z }, dur)
  }, [animateView, getViewport])

  // @@@ initial framing only - center the root once after first paint. Thereafter ONLY keyboard nav
  // pans (see `go` below); a mouse click sets focus WITHOUT moving the camera. Click-focus and
  // arrow-focus are different interaction logics, so the camera follows only the keyboard one.
  const framedRef = useRef(false)
  useEffect(() => {
    if (framedRef.current) return
    framedRef.current = true
    const id = requestAnimationFrame(() => centerOn(focus, undefined, 0))
    return () => cancelAnimationFrame(id)
  }, [centerOn, focus])

  // @@@ keys - capture phase so we win over react-flow. Graph mode: ←↑↓→ walk the tree, +/-/0 zoom,
  // `i` opens the node-info popup, Enter opens the session interface. A modal (popup or session UI)
  // OWNS the keys while open — arrows no longer leak through to move the board behind it (the old
  // blind-navigation bug); the session interface handles its own list nav / input.
  // open the session interface; if a session id is given, land on that tab (else keep the persisted one).
  const openSession = useCallback((sid) => { if (sid) setSessionSel(sid); setSessionUI(true) }, [])
  // @@@ cross to session - from a focused node (board Enter or the node-info popup), cross from READING
  // the node to ACTING on it. Driven by the LIVE OVERLAY (sessions editing this node), never node.session:
  //   exactly one live editor -> jump straight into it
  //   none                    -> New Session, prefilled with @<node-id> (start working on it in place)
  //   several                 -> open the session interface so the user picks which editor to drive
  // (the 'new' tab prefills @focus.id because SessionInterface reads focusNode=focus.)
  const crossToSession = useCallback((node) => {
    const editors = liveEditorsOf(node)
    if (editors.length === 1) openSession(editors[0].id)
    else if (editors.length === 0) openSession('new')
    else setSessionUI(true)
  }, [liveEditorsOf, openSession])

  useEffect(() => {
    const cyclePane = (dir) => setPane((p) => PANE_KEYS[(PANE_KEYS.indexOf(p) + dir + PANE_KEYS.length) % PANE_KEYS.length])
    // keyboard nav both focuses AND pans (the camera follows the keyboard). Mouse focus does not — see
    // onNodeClick. This is the split: arrow-key focus recenters; click focus stays put.
    const go = (t, e) => { if (t) { e.preventDefault(); e.stopPropagation(); setFocusId(t.id); centerOn(t) } }
    const onKey = (e) => {
      if (sessionUI) {
        if (e.key === 'Escape') { e.preventDefault(); setSessionUI(false) }
        return // the session interface owns arrows / Enter / typing
      }
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return }
        // ←/→ cycle the panes (alongside Tab and 1/2/3) — they switch tabs, NOT the board behind.
        if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); cyclePane(-1); return }
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); cyclePane(1); return }
        if (['1', '2', '3'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setPane(PANE_KEYS[+e.key - 1]); return }
        // Enter crosses from reading the node to driving its agent — into the node's live editor(s) via
        // the live overlay (one -> jump, none -> New Session @node, several -> pick). The popup closes behind.
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOverlay(false); crossToSession(focus); return }
        return // ↑/↓ (and anything else) do NOT move the board behind the popup
      }
      // graph mode (no modal open). `?` toggles the floating legend; Esc closes it. Placed AFTER the
      // sessionUI/overlay guards above, so a modal owning the keys is never disturbed by `?`/Esc here.
      if (e.key === '?') { e.preventDefault(); setLegend((v) => !v); return }
      if (e.key === 'Escape' && legend) { e.preventDefault(); setLegend(false); return }
      if (e.key === 'ArrowUp')    return go(upTarget, e)
      if (e.key === 'ArrowDown')  return go(downTarget, e)
      if (e.key === 'ArrowLeft')  return go(parent, e)
      if (e.key === 'ArrowRight') return go(childTarget, e)
      if (e.key === '=' || e.key === '+') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (e.key === '0') { e.preventDefault(); centerOn(focus, 0.85, 200) }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setOverlay(true) }
      // Enter crosses to the focus node's live editor(s) — jump / New Session / pick (see crossToSession).
      else if (e.key === 'Enter') { e.preventDefault(); crossToSession(focus) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, sessionUI, legend, focus, upTarget, downTarget, childTarget, parent, centerOn, getViewport, crossToSession])

  // clicking a node ONLY focuses it — it does NOT pan the camera (recentering is keyboard-only, see
  // `go`) and does NOT open a session (Enter is the deliberate cross into one). Mouse focus and
  // keyboard focus are separate interaction logics; click moves the highlight, not the viewpoint.
  const onNodeClick = useCallback((_e, n) => setFocusId(n.id), [])

  // double-click is the mouse parallel to the `i` key: focus the node AND open its info popup.
  // (single click still only focuses without panning; the camera follows the keyboard alone.)
  const onNodeDoubleClick = useCallback((_e, n) => { setFocusId(n.id); setOverlay(true) }, [])

  // clicking a session in the top-right window: toggle highlight of its worktree's overlays (matched
  // by source = worktree path) + jump to its first changed node (only .session-linked sessions carry
  // ops; a bare tmux session has none, so it just toggles selection).
  const onPickSession = useCallback((s) => {
    setHighlightId((cur) => (cur === s.source ? null : s.source))
    const first = s.ops?.[0]
    if (first && byId[first.nodeId]) setFocusId(first.nodeId)
  }, [byId])

  return (
    <div className="app">
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
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="hud">
          <span className="brand">$ spec-dashboard</span>
          <div className="navhints">
            <span><kbd>↑</kbd><kbd>↓</kbd> siblings</span>
            <span><kbd>←</kbd> parent</span>
            <span><kbd>→</kbd> child</span>
            <span><kbd>+</kbd><kbd>-</kbd> zoom</span>
            <span><kbd>i</kbd> info</span>
            <span><kbd>?</kbd> legend</span>
            <span><kbd>⏎</kbd> session · <kbd>esc</kbd> back</span>
          </div>
        </div>

        <SessionWindow sessions={sessions} activeId={highlightId} onPick={onPickSession} onOpen={() => setSessionUI(true)} />

        {legend && <Legend onClose={() => setLegend(false)} />}
      </div>

      {overlay && <NodeView node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} />}
      {sessionUI && (
        <SessionInterface
          sessions={sessions}
          focusNode={focus}
          sel={sessionSel}
          setSel={setSessionSel}
          onClose={() => setSessionUI(false)}
          onCreated={async (id) => { await reload(); if (id) setSessionSel(id) }}
        />
      )}
    </div>
  )
}

// @@@ App - loads the board (merged spec tree + live worktree overlay) and polls it so pending
// changes from other worktrees appear without a refresh. Keeps the last good board across reloads.
export default function App() {
  const [board, setBoard] = useState(null)
  const reload = useCallback(() => loadBoard().then(setBoard).catch(() => {}), [])
  useEffect(() => {
    reload()
    const id = setInterval(reload, 4000)
    return () => clearInterval(id)
  }, [reload])
  if (!board) return <div className="loading">loading specs from git…</div>
  return <Dashboard specs={board.nodes} sessions={board.sessions} reload={reload} />
}
