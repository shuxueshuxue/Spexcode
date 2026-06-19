import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { PANES } from './NodeView.jsx'
import SessionWindow from './SessionWindow.jsx'
import SessionInterface from './SessionInterface.jsx'
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
  const [sessionSel, setSessionSel] = useState('new') // persisted across open/close: last tab/session
  const [highlightId, setHighlightId] = useState(null) // session whose overlays are emphasised
  const { getViewport, setViewport } = useReactFlow()
  const graphRef = useRef(null)
  const animRef = useRef(0)

  const byId = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  // focus is resilient to the board reflowing under polling (a merged/closed node may vanish).
  const focus = byId[focusId] || specs.find((s) => !s.parent) || specs[0]

  // @@@ node<->session link - a node's `session` IS the id of the Claude Code session that authored it
  // (git Session: trailer; the live worktree runs under `--session-id` of that same id). So a node maps
  // to a LIVE session by exact id match. This is the board->session half of the bidirectional link.
  const sessionById = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])
  const liveSessionFor = useCallback((node) => (node?.session && sessionById[node.session]) || null, [sessionById])

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
    // a node whose author session is live carries a `link` so SpecNode can stamp the subtle ⏎ affordance.
    const live = liveSessionFor(s)
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y },
      data: live ? { ...s, link: { color: live.color, status: live.status } } : s,
      draggable: false, selected: s.id === focusId, className,
    }
  }), [focusId, focus.parent, highlightId, specs, liveSessionFor])

  const edges = useMemo(() => specs.filter((s) => s.parent).map((s) => {
    const hot = s.id === focusId || s.parent === focusId
    return {
      id: `${s.parent}-${s.id}`, source: s.parent, target: s.id, type: 'smoothstep',
      style: { stroke: hot ? '#268bd2' : '#ded7bf', strokeWidth: hot ? 2 : 1 }, zIndex: hot ? 1 : 0,
    }
  }), [focusId, specs])

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

  useEffect(() => {
    const id = requestAnimationFrame(() => centerOn(focus, undefined, 300))
    return () => cancelAnimationFrame(id)
  }, [focusId]) // eslint-disable-line

  // @@@ keys - capture phase so we win over react-flow. Graph mode: ←↑↓→ walk the tree, +/-/0 zoom,
  // `i` opens the node-info popup, Enter opens the session interface. A modal (popup or session UI)
  // OWNS the keys while open — arrows no longer leak through to move the board behind it (the old
  // blind-navigation bug); the session interface handles its own list nav / input.
  // open the session interface; if a session id is given, land on that tab (else keep the persisted one).
  const openSession = useCallback((sid) => { if (sid) setSessionSel(sid); setSessionUI(true) }, [])

  useEffect(() => {
    const cyclePane = (dir) => setPane((p) => PANE_KEYS[(PANE_KEYS.indexOf(p) + dir + PANE_KEYS.length) % PANE_KEYS.length])
    const go = (t, e) => { if (t) { e.preventDefault(); e.stopPropagation(); setFocusId(t.id) } }
    const onKey = (e) => {
      if (sessionUI) {
        if (e.key === 'Escape') { e.preventDefault(); setSessionUI(false) }
        return // the session interface owns arrows / Enter / typing
      }
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return }
        if (['1', '2', '3'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setPane(PANE_KEYS[+e.key - 1]); return }
        return // arrows do NOT move the board behind the popup
      }
      if (e.key === 'ArrowUp')    return go(upTarget, e)
      if (e.key === 'ArrowDown')  return go(downTarget, e)
      if (e.key === 'ArrowLeft')  return go(parent, e)
      if (e.key === 'ArrowRight') return go(childTarget, e)
      if (e.key === '=' || e.key === '+') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (e.key === '0') { e.preventDefault(); centerOn(focus, 0.85, 200) }
      else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setOverlay(true) }
      // Enter opens the session interface — focused on the focus node's live session if it has one.
      else if (e.key === 'Enter') { e.preventDefault(); openSession(liveSessionFor(focus)?.id) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, sessionUI, pane, focus, upTarget, downTarget, childTarget, parent, centerOn, getViewport, openSession, liveSessionFor])

  // clicking a node focuses it; if its author session is LIVE, also open the session interface on it
  // (the board->session half of the link, mirroring the session window's click-to-focus-node).
  const onNodeClick = useCallback((_e, n) => {
    setFocusId(n.id)
    const live = liveSessionFor(n.data)
    if (live) openSession(live.id)
  }, [liveSessionFor, openSession])

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
            <span><kbd>⏎</kbd> session · <kbd>esc</kbd> back</span>
          </div>
        </div>

        <SessionWindow sessions={sessions} activeId={highlightId} onPick={onPickSession} onOpen={() => setSessionUI(true)} />
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
