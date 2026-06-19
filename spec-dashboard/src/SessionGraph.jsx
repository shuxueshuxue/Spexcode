import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position,
  MarkerType, useReactFlow,
} from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { useT } from './i18n/index.jsx'

// @@@ session-graph - the EXPERIMENTAL directed monitor network: each session is a node, each LIVE
// monitor a directed arrow A→B meaning "agent A is right now running `spex watch B`". Live edges are
// DERIVED from live watches (GET /api/sessions/graph), never stored. The view is OBSERVATIONAL — it
// reflects who is watching whom and updates as watches start/stop — but it ALSO lets a human ASK: dragging
// A→B dispatches a PROMPT to agent A telling it to monitor B (POST /keys; NO subscription store). That
// gesture is optimistic — a pending dashed edge + a toast appear immediately so the user never wonders if
// it worked — and the edge goes solid once A's real `spex watch` registration shows up on the next poll.
// Deliberately ISOLATED from the spec board — its own ReactFlowProvider (so it never shares the board's
// camera/selection state), its own data, its own keys. `t` (and a HUD button) toggles it; Esc returns.
// Nodes REUSE the shared seed-to-hue colour + avatar (color.js / avatar.jsx) keyed off the session id, so
// a face here matches the same session's stripe/avatar everywhere else on the dashboard.

const sessionLabel = (s, t) => s.node || s.title || s.branch || (s.id ? s.id.slice(0, 8) : t('common.session'))

// @@@ GraphNode - a session as a network node: its avatar + label, ringed in its own hue. The handles are
// the anchor points ReactFlow routes arrows to/from AND the drag targets for asking a monitor: drag from a
// node's bottom (source) handle onto another's top (target) handle to ask the first to watch the second.
function GraphNode({ data }) {
  const t = useT()
  const color = labelColor(data.id)
  return (
    <div className="sg-node" style={{ '--sg': color }} title={data.promptPreview || sessionLabel(data, t)}>
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

function GraphCanvas({ onClose, onOpen }) {
  const t = useT()
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const [loaded, setLoaded] = useState(false)        // first fetch done → safe to mount already-framed
  const [pending, setPending] = useState([])         // optimistic monitor edges, awaiting the live watch
  const [toast, setToast] = useState(null)           // brief "asked A to monitor B" reassurance
  const { fitView } = useReactFlow()
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

  // Esc returns to the spec board. Owned here so nav never leaks to the board behind.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pos = useMemo(() => radial(graph.nodes), [graph.nodes])
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((s) => [s.id, s])), [graph.nodes])
  const rfNodes = useMemo(() => graph.nodes.map((s) => ({
    id: s.id, type: 'session', position: pos[s.id] || { x: 0, y: 0 }, data: s, draggable: true,
  })), [graph.nodes, pos])

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

  // @@@ ask-to-monitor - dragging A→B is NOT drawing a stored edge: it dispatches a PROMPT to agent A (the
  // watcher) over the existing /keys channel, asking it to run `spex watch B` (its monitor tool). We add an
  // optimistic pending edge + a toast right away so the gesture feels acknowledged; the real arrow firms up
  // when A's live watch registration arrives on the next poll. No subscription is ever written here.
  const onConnect = useCallback(({ source, target }) => {
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
  // mechanism); the graph closes behind it. A single click is unambiguously "open": connectOnClick is OFF
  // (below), so only a handle DRAG asks-to-monitor — a click never doubles as a connect.
  const onNodeClick = useCallback((_e, n) => onOpen?.(n.id), [onOpen])

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
        onConnect={onConnect} onNodeClick={onNodeClick}
        nodesDraggable nodesConnectable connectOnClick={false} elementsSelectable={false}
        defaultViewport={frameViewport(pos, graph.nodes)} minZoom={0.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {toast && <div className="sg-toast">{toast}</div>}
    </>
  )
}

// @@@ SessionGraph - full-screen overlay. Wrapped in its OWN ReactFlowProvider so it shares NOTHING with
// the board's ReactFlow instance (separate camera, selection, store) — the isolation that lets it drop in
// without touching the existing views. onOpen crosses a clicked node into its session console (board path).
export default function SessionGraph({ onClose, onOpen }) {
  const t = useT()
  return (
    <div className="session-graph">
      <div className="sg-hud">
        <span className="brand">$ session-graph</span>
        <span className="sg-hint">{t('sessionGraph.hint')}</span>
      </div>
      <ReactFlowProvider>
        <GraphCanvas onClose={onClose} onOpen={onOpen} />
      </ReactFlowProvider>
    </div>
  )
}
