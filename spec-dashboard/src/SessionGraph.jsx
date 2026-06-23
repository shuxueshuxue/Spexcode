import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Handle, Position,
  MarkerType, ConnectionMode, useReactFlow,
} from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import Modal from './Modal.jsx'
import { useT } from './i18n/index.jsx'

// @@@ session-graph - the EXPERIMENTAL directed monitor network: each session is a node, each LIVE
// monitor a directed arrow A→B meaning "agent A is right now running `spex watch B`". Live edges are
// DERIVED from live watches (GET /api/sessions/graph), never stored. The view is OBSERVATIONAL — it
// reflects who is watching whom and updates as watches start/stop — but it ALSO lets a human ASK: dragging
// A→B dispatches a PROMPT to agent A telling it to monitor B (POST /keys; NO subscription store). That
// gesture is optimistic — a pending dashed edge + a toast appear immediately so the user never wonders if
// it worked — and the edge goes solid once A's real `spex watch` registration shows up on the next poll.
// This view LIVES INSIDE the session console as the "View Session Relationship" tab (see SessionInterface):
// it fills the right content pane when that tab is active, NOT a fullscreen overlay. It stays ISOLATED all
// the same — its own ReactFlowProvider (so it never shares the board's or any other ReactFlow's
// camera/selection state) and its own data. The CONSOLE owns the ARROWS and Esc: you reach this tab from an
// empty New Session with → and leave it with ← (a horizontal axis off New), the other arrows are inert, and
// Esc closes the console (or this view's legend first). What's LEFT to this view is the in-graph nav: hjkl
// walk the web to the nearest node in that direction (the camera following) — arrows never move the cursor —
// and ⏎ opens the focused session, the twin of a click, which here switches to that session's console tab
// (onOpen → setSel).
// Nodes REUSE the shared seed-to-hue colour + avatar (color.js / avatar.jsx) keyed off the session id, so
// a face here matches the same session's stripe/avatar everywhere else on the dashboard.

// name (the manual rename override) wins over the derived label on EVERY surface — mirror session.js's
// sessionName precedence here too, just with the graph's short id fallback.
const sessionLabel = (s, t) => s.name || s.node || s.title || s.branch || (s.id ? s.id.slice(0, 8) : t('common.session'))

// @@@ GraphNode - a session as a network node: its avatar + label, ringed in its own hue. The two handles
// are the anchor points ReactFlow routes arrows to/from AND the drag targets for asking a monitor. With
// connectionMode=loose (see ReactFlow below) EITHER handle of one node connects to EITHER of another, so a
// drag never fails just because two ring-arranged nodes face away from each other; direction (who watches
// whom) is the DRAG direction, not which handle was grabbed — drag from the watcher onto the watched.
function GraphNode({ data }) {
  const t = useT()
  const color = labelColor(data.id)
  // `focus` rings the node the keyboard targets: the one under the cursor, which ⏎ opens (see onNodeMouseEnter).
  return (
    <div className={`sg-node${data.focus ? ' sg-node--focus' : ''}`} style={{ '--sg': color }} title={data.promptPreview || sessionLabel(data, t)}>
      <Handle type="target" position={Position.Top} className="sg-handle" />
      <Avatar seed={data.id} status={data.status} size={34} title={`${sessionLabel(data, t)} · ${t(`status.${data.status}`)}`} />
      <span className="sg-label">{sessionLabel(data, t)}</span>
      <span className="sg-status">{t(`status.${data.status}`)}</span>
      <Handle type="source" position={Position.Bottom} className="sg-handle" />
    </div>
  )
}
const nodeTypes = { session: GraphNode }

// @@@ radial layout - a network layout, NOT a tree: sessions are placed evenly around a circle whose
// radius grows with the count, so the directed edges read as a web of relationships. Pure view concern,
// computed client-side (the backend serves topology, never pixels). Centred on the origin.
function radial(sessions) {
  const n = sessions.length
  const R = Math.max(200, n * 52)
  const pos = {}
  sessions.forEach((s, i) => {
    const a = (i / Math.max(1, n)) * 2 * Math.PI - Math.PI / 2
    pos[s.id] = { x: Math.round(Math.cos(a) * R), y: Math.round(Math.sin(a) * R) }
  })
  return pos
}

function GraphCanvas({ onOpen, active, legend, setLegend }) {
  const t = useT()
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [loaded, setLoaded] = useState(false)        // first fetch done → safe to mount already-framed
  const [pending, setPending] = useState([])         // optimistic monitor edges, awaiting the live watch
  const [toast, setToast] = useState(null)           // brief "asked A to monitor B" reassurance
  const [focusId, setFocusId] = useState(null)       // keyboard cursor: the node arrows move and ⏎ opens
  const { fitView, setCenter, getViewport } = useReactFlow()
  const framedRef = useRef(false)
  const toastTimer = useRef(0)

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions/graph')
      setGraph(await res.json())
    } catch { /* transient; keep the last good graph */ }
    finally { setLoaded(true) }
  }, [])
  useEffect(() => { reload(); const id = setInterval(reload, 4000); return () => clearInterval(id) }, [reload])

  // The CONSOLE owns the universal keys (↑/↓ walk the tab list, Esc closes the console/this legend). What's
  // LEFT to this view — handled in the nav effect below — is the in-graph nav: hjkl move the cursor, ⏎ opens
  // the focused session, `?` toggles the legend. The console's window listener runs FIRST (it mounts first)
  // and consumes ↑/↓/Esc; the keys it doesn't touch (hjkl/⏎/?) fall through to ours.

  const pos = useMemo(() => radial(graph.nodes), [graph.nodes])
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((s) => [s.id, s])), [graph.nodes])
  const rfNodes = useMemo(() => graph.nodes.map((s) => ({
    id: s.id, type: 'session', position: pos[s.id] || { x: 0, y: 0 },
    data: { ...s, focus: s.id === focusId }, draggable: true,
  })), [graph.nodes, pos, focusId])

  // a live monitor A→B already registered drops its optimistic twin — the pending edge has become real.
  useEffect(() => {
    if (!pending.length) return
    const live = new Set(graph.edges.map((e) => `${e.from}->${e.to}`))
    setPending((p) => p.filter((e) => !live.has(`${e.from}->${e.to}`)))
  }, [graph.edges]) // eslint-disable-line react-hooks/exhaustive-deps

  // each live monitor A→B is a solid directed arrow in the WATCHER's hue; each PENDING (asked-but-not-yet-
  // registered) monitor is the same arrow dashed, so the user sees their request land instantly and watches
  // it firm up when the real watch appears. Both keyed the same so a live edge supersedes its pending twin.
  const rfEdges = useMemo(() => {
    const live = graph.edges.map((e) => {
      const stroke = labelColor(e.from)
      return {
        id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: 'smoothstep', animated: true,
        style: { stroke, strokeWidth: 2 }, className: 'sg-edge',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      }
    })
    const liveIds = new Set(live.map((e) => e.id))
    const optimistic = pending.filter((e) => !liveIds.has(`${e.from}->${e.to}`)).map((e) => {
      const stroke = labelColor(e.from)
      return {
        id: `pending:${e.from}->${e.to}`, source: e.from, target: e.to, type: 'smoothstep', animated: true,
        style: { stroke, strokeWidth: 2, strokeDasharray: '5 5', opacity: 0.7 }, className: 'sg-edge sg-pending',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      }
    })
    return [...live, ...optimistic]
  }, [graph.edges, pending])

  const flash = useCallback((text) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // the node a connection drag STARTED on — the watcher. We pin direction to this, not to the source/target
  // ReactFlow hands onConnect: in loose mode it labels those by handle TYPE (top=target, bottom=source), so
  // a drag that happens to end on a source handle would otherwise come back reversed. The gesture is truth.
  const dragFrom = useRef(null)
  const onConnectStart = useCallback((_e, params) => { dragFrom.current = params?.nodeId || null }, [])

  // @@@ ask-to-monitor - dragging A→B is NOT drawing a stored edge: it dispatches a PROMPT to agent A (the
  // watcher) over the existing /keys channel, asking it to run `spex watch B` (its monitor tool). We add an
  // optimistic pending edge + a toast right away so the gesture feels acknowledged; the real arrow firms up
  // when A's live watch registration arrives on the next poll. No subscription is ever written here. The
  // watcher is the node the drag STARTED on (dragFrom); the watched is the other end — see onConnectStart.
  const onConnect = useCallback((conn) => {
    const ends = [conn.source, conn.target]
    const source = dragFrom.current && ends.includes(dragFrom.current) ? dragFrom.current : conn.source
    const target = ends.find((id) => id !== source)
    dragFrom.current = null
    if (!source || !target || source === target) return
    const a = byId[source], b = byId[target]
    const labelA = a ? sessionLabel(a, t) : source.slice(0, 8)
    const labelB = b ? sessionLabel(b, t) : target.slice(0, 8)
    setPending((p) => (p.some((e) => e.from === source && e.to === target) ? p : [...p, { from: source, to: target }]))
    flash(t('sessionGraph.asked', { a: labelA, b: labelB }))
    fetch(`/api/sessions/${source}/keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t('sessionGraph.monitorPrompt', { label: labelB, id: target }), enter: true }),
    }).catch(() => { /* the optimistic edge stands until a poll proves it never registered */ })
  }, [byId, t, flash])

  // clicking a node switches the console to that session's tab (onOpen → setSel) — the graph and the session
  // consoles are sibling tabs of one board, so "open" is just a tab switch, no new mechanism. A single click
  // is unambiguously "open": connectOnClick is OFF (below), so only a handle DRAG asks-to-monitor — a click
  // never doubles as a connect.
  const onNodeClick = useCallback((_e, n) => onOpen?.(n.id), [onOpen])

  // keep a keyboard cursor alive: once the graph loads, focus the first node so arrows/⏎ have a start
  // point; if the focused session disappears between polls (closed/merged), fall back to the first node.
  useEffect(() => {
    if (!graph.nodes.length) { if (focusId !== null) setFocusId(null); return }
    if (!focusId || !graph.nodes.some((s) => s.id === focusId)) setFocusId(graph.nodes[0].id)
  }, [graph.nodes, focusId])

  // @@@ directional nav - the radial layout is a network, not a tree, so there is no parent/child to walk:
  // an hjkl key moves the cursor to the NEAREST node inside a 45° cone in that screen direction, which reads
  // naturally on a ring. We pan the camera to follow (keyboard-only — click never moves it). ⏎ opens the
  // focused session (the keyboard twin of a click). pos/byId are flow coords, the same space setCenter wants,
  // so no projection is needed. The ARROWS are deliberately NOT bound here — the console owns them (← leaves
  // to New Session, the rest inert), so the graph's web-walk is vim-only: hjkl move the cursor, nothing else.
  const CONES = useMemo(() => ({
    l: (dx, dy) => dx > 0 && dx >= Math.abs(dy),
    h: (dx, dy) => dx < 0 && -dx >= Math.abs(dy),
    j: (dx, dy) => dy > 0 && dy >= Math.abs(dx),
    k: (dx, dy) => dy < 0 && -dy >= Math.abs(dx),
  }), [])
  const focusRef = useRef(focusId); focusRef.current = focusId
  useEffect(() => {
    if (!active) return // not the active tab (or the console is closed) — it owns the keys, ours stay quiet
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // the help modal (keymap + legend) owns ITS keys while open: `?` closes it (Esc too, but the console's
      // listener catches Esc first and closes the legend — see SessionInterface), nav never leaks behind it.
      if (legend) {
        if (e.key === '?') { e.preventDefault(); e.stopPropagation(); setLegend(false) }
        return
      }
      if (e.key === '?') { e.preventDefault(); e.stopPropagation(); setLegend(true); return }
      const cur = byId[focusRef.current]
      if (e.key === 'Enter') {
        if (cur) { e.preventDefault(); e.stopPropagation(); onOpen?.(cur.id) }
        return
      }
      const cone = CONES[e.key]
      if (!cone || !cur) return
      e.preventDefault(); e.stopPropagation()
      const c = pos[cur.id] || { x: 0, y: 0 }
      let best = null, bestD = Infinity
      for (const s of graph.nodes) {
        if (s.id === cur.id) continue
        const p = pos[s.id] || { x: 0, y: 0 }
        const dx = p.x - c.x, dy = p.y - c.y
        if (!cone(dx, dy)) continue
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = s.id }
      }
      if (best) {
        setFocusId(best)
        const p = pos[best]
        if (p) setCenter(p.x, p.y, { zoom: getViewport().zoom, duration: 160 })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, byId, pos, graph.nodes, CONES, onOpen, setCenter, getViewport, legend, setLegend])

  // @@@ frame to the pane - the web is origin-centred in flow coords; fitView frames it within whatever size
  // the content pane gives us (no window-based pre-frame — this is an in-pane tab, not a fullscreen overlay).
  // First paint snaps (duration 0) so the graph opens already centred; a later session-count change pans.
  useEffect(() => {
    if (!loaded || !rfNodes.length) return
    const first = !framedRef.current
    framedRef.current = true
    requestAnimationFrame(() => fitView({ padding: 0.25, duration: first ? 0 : 300 }))
  }, [rfNodes.length, loaded, fitView])

  // hold the empty pane until the first graph arrives; the frame effect then fits it (see above).
  if (!loaded) return <div className="sg-loading">{t('common.loading')}</div>

  return (
    <>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onConnect={onConnect} onConnectStart={onConnectStart} onNodeClick={onNodeClick}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable nodesConnectable connectOnClick={false} elementsSelectable={false}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }} minZoom={0.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
      </ReactFlow>
      {toast && <div className="sg-toast">{toast}</div>}
    </>
  )
}

// @@@ SessionGraphLegend - the session graph's keymap + edge vocabulary, shown in the shared centered Modal
// opened by the tab's discreet `?` (key or click) — the SAME affordance the spec board uses (see Legend.jsx),
// so the wall of inline hints that used to stand in the HUD lives behind one button. The keymap mirrors the
// embedded model: hjkl walk the web (arrows are the console tab-list's), ⏎ opens, and you leave via the tabs.
function SessionGraphLegend({ onClose }) {
  const t = useT()
  const KEYS = [
    [['h', 'j', 'k', 'l'], 'move'],
    [['⏎'], 'open'],
    [['←'], 'leave'],
  ]
  return (
    <Modal title={t('sessionGraph.legend.title')} closeLabel={t('sessionGraph.legend.close')} onClose={onClose}>
      <section className="legend-sec">
        <div className="legend-h">{t('sessionGraph.legend.secKeys')}</div>
        {KEYS.map(([keys, descKey]) => (
          <div className="legend-row" key={descKey}>
            <span className="keymap-keys">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
            <span className="legend-desc">{t(`sessionGraph.legend.${descKey}`)}</span>
          </div>
        ))}
        <div className="legend-row">
          <span className="legend-desc">{t('sessionGraph.legend.monitor')}</span>
        </div>
      </section>
      <section className="legend-sec">
        <div className="legend-h">{t('sessionGraph.legend.secEdges')}</div>
        <div className="legend-row">
          <span className="legend-desc">{t('sessionGraph.legend.edgesDesc')}</span>
        </div>
      </section>
    </Modal>
  )
}

// @@@ SessionGraph - the "View Session Relationship" tab body: it FILLS the console's right content pane
// (absolute inset:0 over a positioned pane), NOT a fullscreen overlay. Wrapped in its OWN ReactFlowProvider
// so it shares NOTHING with the spec board's ReactFlow instance (separate camera, selection, store) — the
// isolation that lets it sit inside the console without touching the board behind it. `onOpen` switches the
// console to a clicked node's session tab (setSel). `active` is true while this tab is the one selected;
// `legend`/`setLegend` are LIFTED to the console so its Esc handler can close the legend before the console.
export default function SessionGraph({ onOpen, active = true, legend, setLegend }) {
  const t = useT()
  return (
    <div className="session-graph">
      {/* a single discreet `?` — the same help affordance the spec board uses — opens the keymap/edge legend.
          No brand/back chrome: the tab IS the frame, and leaving is just picking another tab. */}
      <div className="sg-hud">
        <button className="hud-help" onClick={() => setLegend((v) => !v)} title={t('sessionGraph.helpTitle')}>?</button>
      </div>
      <ReactFlowProvider>
        <GraphCanvas onOpen={onOpen} active={active} legend={legend} setLegend={setLegend} />
      </ReactFlowProvider>
      {legend && <SessionGraphLegend onClose={() => setLegend(false)} />}
    </div>
  )
}
