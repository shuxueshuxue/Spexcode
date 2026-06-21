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
// Deliberately ISOLATED from the spec board — its own ReactFlowProvider (so it never shares the board's
// camera/selection state), its own data, its own keys: a keyboard cursor walks the web (arrows/hjkl move
// to the nearest node in that direction, the camera following) and ⏎ opens the focused session, the twin
// of a click. `t` is the ONLY switch in or out (it toggles both graphs, owned by App so it works from
// either) — Esc does nothing here, and opening a session console over this view never closes it (you
// return to this graph when the console closes; while it is open it owns the keys, so our nav goes quiet).
// Nodes REUSE the shared seed-to-hue colour + avatar (color.js / avatar.jsx) keyed off the session id, so
// a face here matches the same session's stripe/avatar everywhere else on the dashboard.

const sessionLabel = (s, t) => s.node || s.title || s.branch || (s.id ? s.id.slice(0, 8) : t('common.session'))

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

// @@@ frame on open - pre-compute a viewport that already frames the whole radial web from the node bounds
// + the full-screen size, so the very FIRST paint lands centred (no empty-screen-then-pan). The radial is
// origin-centred, so this is essentially window-centre at a fit-to-bounds zoom; pad covers a node's extent.
function frameViewport(pos, sessions) {
  if (!sessions.length) return { x: 0, y: 0, zoom: 0.8 }
  const xs = sessions.map((s) => pos[s.id]?.x ?? 0)
  const ys = sessions.map((s) => pos[s.id]?.y ?? 0)
  const pad = 110
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad
  const w = window.innerWidth, h = window.innerHeight
  const zoom = Math.max(0.3, Math.min(1.4, Math.min(w / (maxX - minX), h / (maxY - minY))))
  return { x: w / 2 - ((minX + maxX) / 2) * zoom, y: h / 2 - ((minY + maxY) / 2) * zoom, zoom }
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

  // `t` (the only switch between the two graphs) stays owned by App so it toggles both ways from one place
  // and is suppressed while the session console captures keys; Esc still does NOT leave this view. The
  // REMAINING keys (arrow/hjkl nav + ⏎ to open) are this graph's own and handled below — App bails to us
  // for them (`if (graphView) return`). See the nav effect after onNodeClick.

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

  // clicking a node crosses into that session's console — reuse of the board's open-session path (no new
  // mechanism). The session graph stays mounted BEHIND the console (graphView is untouched), so closing
  // the console returns here, not to the spec graph. A single click is unambiguously "open": connectOnClick
  // is OFF (below), so only a handle DRAG asks-to-monitor — a click never doubles as a connect.
  const onNodeClick = useCallback((_e, n) => onOpen?.(n.id), [onOpen])

  // keep a keyboard cursor alive: once the graph loads, focus the first node so arrows/⏎ have a start
  // point; if the focused session disappears between polls (closed/merged), fall back to the first node.
  useEffect(() => {
    if (!graph.nodes.length) { if (focusId !== null) setFocusId(null); return }
    if (!focusId || !graph.nodes.some((s) => s.id === focusId)) setFocusId(graph.nodes[0].id)
  }, [graph.nodes, focusId])

  // @@@ directional nav - the radial layout is a network, not a tree, so there is no parent/child to walk:
  // an arrow (or its hjkl twin) moves the cursor to the NEAREST node inside a 45° cone in that screen
  // direction, which reads naturally on a ring. We pan the camera to follow (keyboard-only — click never
  // moves it). ⏎ opens the focused session (the keyboard twin of a click). pos/byId are flow coords, the
  // same space setCenter wants, so no projection is needed.
  const CONES = useMemo(() => ({
    ArrowRight: (dx, dy) => dx > 0 && dx >= Math.abs(dy), l: (dx, dy) => dx > 0 && dx >= Math.abs(dy),
    ArrowLeft:  (dx, dy) => dx < 0 && -dx >= Math.abs(dy), h: (dx, dy) => dx < 0 && -dx >= Math.abs(dy),
    ArrowDown:  (dx, dy) => dy > 0 && dy >= Math.abs(dx), j: (dx, dy) => dy > 0 && dy >= Math.abs(dx),
    ArrowUp:    (dx, dy) => dy < 0 && -dy >= Math.abs(dx), k: (dx, dy) => dy < 0 && -dy >= Math.abs(dx),
  }), [])
  const focusRef = useRef(focusId); focusRef.current = focusId
  useEffect(() => {
    if (!active) return // a session console is open over this graph — it owns the keys (incl. ⏎ and arrows)
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // the help modal (keymap + legend) is itself a modal: while open it OWNS the keys — only `?`/Esc
      // close it, nav never leaks to the graph behind. `?` opens it from the board.
      if (legend) {
        if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); setLegend(false) }
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

  // re-frame gently when the session count changes AFTER the first paint (a watch/session appeared); the
  // first paint is already framed by the computed defaultViewport, so we skip it to avoid a redundant pan.
  useEffect(() => {
    if (!loaded) return
    if (!framedRef.current) { framedRef.current = true; return }
    if (rfNodes.length) requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300 }))
  }, [rfNodes.length, loaded, fitView])

  // hold the empty overlay until the first graph arrives, THEN mount already-framed (see frameViewport).
  if (!loaded) return <div className="sg-loading">{t('common.loading')}</div>

  return (
    <>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
        onConnect={onConnect} onConnectStart={onConnectStart} onNodeClick={onNodeClick}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable nodesConnectable connectOnClick={false} elementsSelectable={false}
        defaultViewport={frameViewport(pos, graph.nodes)} minZoom={0.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
      </ReactFlow>
      {toast && <div className="sg-toast">{toast}</div>}
    </>
  )
}

// @@@ SessionGraphLegend - the session graph's keymap + edge vocabulary, shown in the shared centered Modal
// opened by the HUD's discreet `?` (key or click) — the SAME affordance the spec board uses (see Legend.jsx),
// so the wall of inline hints that used to sit in the HUD now lives behind one button on BOTH graphs.
function SessionGraphLegend({ onClose }) {
  const t = useT()
  const KEYS = [
    [['↑', 'k', '↓', 'j', '←', 'h', '→', 'l'], 'move'],
    [['⏎'], 'open'],
    [['t'], 'back'],
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

// @@@ SessionGraph - full-screen overlay. Wrapped in its OWN ReactFlowProvider so it shares NOTHING with
// the board's ReactFlow instance (separate camera, selection, store) — the isolation that lets it drop in
// without touching the existing views. onOpen crosses a clicked node into its session console (board path).
export default function SessionGraph({ onOpen, onBack, active = true }) {
  const t = useT()
  const [legend, setLegend] = useState(false)
  return (
    <div className="session-graph">
      <div className="sg-hud">
        <span className="brand">$ session-graph</span>
        {/* mirror of the board's hud-graph button — toggles back to the spec graph, the same crossing
            the `t` key makes. The tree icon (root → two children) distinguishes it from the network glyph. */}
        {onBack && (
          <button className="hud-graph" onClick={onBack} title={t('sessionGraph.backTitle')}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="3.5" r="1.8" /><circle cx="3.5" cy="12.5" r="1.8" /><circle cx="12.5" cy="12.5" r="1.8" />
              <path d="M8 5.3 V8 M8 8 H3.5 V10.7 M8 8 H12.5 V10.7" />
            </svg>
          </button>
        )}
        <button className="hud-help" onClick={() => setLegend((v) => !v)} title={t('sessionGraph.helpTitle')}>?</button>
      </div>
      <ReactFlowProvider>
        <GraphCanvas onOpen={onOpen} active={active} legend={legend} setLegend={setLegend} />
      </ReactFlowProvider>
      {legend && <SessionGraphLegend onClose={() => setLegend(false)} />}
    </div>
  )
}
