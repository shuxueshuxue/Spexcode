import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, Handle, Position,
  MarkerType, ConnectionMode, useReactFlow,
} from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'

// @@@ session-graph - the EXPERIMENTAL directed political network: each session is a node, each
// subscription (A subscribes to B) a directed arrow A→B. Deliberately ISOLATED from the spec board —
// its own ReactFlowProvider (so it never shares the board's camera/selection state), its own data
// (GET /api/sessions/graph), its own keys. `t` toggles it; Esc returns. Nodes REUSE the shared
// seed-to-hue colour + avatar (color.js / avatar.jsx) keyed off the session id, so a face here matches
// the same session's stripe/avatar everywhere else on the dashboard.

const sessionLabel = (s) => s.node || s.title || s.branch || (s.id ? s.id.slice(0, 8) : 'session')

// @@@ GraphNode - a session as a network node: its avatar + label, ringed in its own hue. Two handles
// (a target + a source) + ConnectionMode.Loose let the user drag from ANY node to ANY node to create a
// subscription, regardless of where each sits in the radial layout.
function GraphNode({ data }) {
  const color = labelColor(data.id)
  return (
    <div className="sg-node" style={{ '--sg': color }} title={data.promptPreview || sessionLabel(data)}>
      <Handle type="target" position={Position.Top} className="sg-handle" />
      <Avatar seed={data.id} status={data.status} size={34} title={`${sessionLabel(data)} · ${data.status}`} />
      <span className="sg-label">{sessionLabel(data)}</span>
      <span className="sg-status">{data.status}</span>
      <Handle type="source" position={Position.Bottom} className="sg-handle" />
    </div>
  )
}
const nodeTypes = { session: GraphNode }

// @@@ radial layout - a network layout, NOT a tree: sessions are placed evenly around a circle whose
// radius grows with the count, so the directed edges read as a web of relationships. Pure view concern,
// computed client-side (the backend serves topology, never pixels).
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

function GraphCanvas({ onClose }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [] })
  const { fitView } = useReactFlow()

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions/graph')
      setGraph(await res.json())
    } catch { /* transient; keep the last good graph */ }
  }, [])
  useEffect(() => { reload(); const id = setInterval(reload, 4000); return () => clearInterval(id) }, [reload])

  // Esc returns to the spec board. Owned here so nav never leaks to the board behind.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pos = useMemo(() => radial(graph.nodes), [graph.nodes])
  const rfNodes = useMemo(() => graph.nodes.map((s) => ({
    id: s.id, type: 'session', position: pos[s.id] || { x: 0, y: 0 }, data: s, draggable: true,
  })), [graph.nodes, pos])
  // each subscription A→B is a directed arrow in the SUBSCRIBER's hue, click-to-remove.
  const rfEdges = useMemo(() => graph.edges.map((e) => {
    const stroke = labelColor(e.from)
    return {
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: 'smoothstep', animated: true,
      style: { stroke, strokeWidth: 2 }, className: 'sg-edge',
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
    }
  }), [graph.edges])

  // frame the whole web once nodes are present (and when the count changes).
  useEffect(() => { if (rfNodes.length) requestAnimationFrame(() => fitView({ padding: 0.25, duration: 300 })) }, [rfNodes.length, fitView])

  const post = useCallback(async (path, from, to) => {
    try { await fetch(`/api/sessions/graph/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }) }) } catch { /* */ }
    reload()
  }, [reload])

  // drag node→node creates the subscription; click an arrow removes it.
  const onConnect = useCallback((c) => { if (c.source && c.target && c.source !== c.target) post('subscribe', c.source, c.target) }, [post])
  const onEdgeClick = useCallback((_e, edge) => post('unsubscribe', edge.source, edge.target), [post])

  return (
    <ReactFlow
      nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
      onConnect={onConnect} onEdgeClick={onEdgeClick}
      connectionMode={ConnectionMode.Loose}
      nodesDraggable nodesConnectable elementsSelectable
      defaultViewport={{ x: 0, y: 0, zoom: 0.8 }} minZoom={0.3} maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}

// @@@ SessionGraph - full-screen overlay. Wrapped in its OWN ReactFlowProvider so it shares NOTHING with
// the board's ReactFlow instance (separate camera, selection, store) — the isolation that lets it drop in
// without touching the existing views.
export default function SessionGraph({ onClose }) {
  return (
    <div className="session-graph">
      <div className="sg-hud">
        <span className="brand">$ session-graph</span>
        <span className="sg-hint">drag node→node to subscribe · click an arrow to remove · Esc to return</span>
      </div>
      <ReactFlowProvider>
        <GraphCanvas onClose={onClose} />
      </ReactFlowProvider>
    </div>
  )
}
