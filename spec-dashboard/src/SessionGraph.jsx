import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Handle, Position,
  MarkerType, useReactFlow,
  BaseEdge, getBezierPath, useInternalNode,
} from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { STATUS_COLOR, sessionHeadline } from './session.js'
import Modal from './Modal.jsx'
import { useT } from './i18n/index.jsx'

// label = the session's shared headline (sessionHeadline); the bare-id fallback is shortened to 8 chars
// (a full id is too wide for a node chip).
const sessionLabel = (s, t) => {
  const h = sessionHeadline(s)
  return h && h !== s.id ? h : (s.id ? s.id.slice(0, 8) : t('common.session'))
}

// the handles are hidden CSS anchors ReactFlow needs to route an edge at all (without one it draws nothing);
// they are not drag affordances — nodesConnectable is off and the monitor gesture is click, not drag.
function GraphNode({ data }) {
  const t = useT()
  const color = labelColor(data.id)
  // `focus` rings the node the keyboard cursor targets (hjkl move, ⏎ opens); `source` rings the node a
  // left-click has picked as the monitor watcher, awaiting the right-click that names the watched.
  const cls = `sg-node${data.focus ? ' sg-node--focus' : ''}${data.source ? ' sg-node--source' : ''}`
  return (
    <div className={cls} style={{ '--sg': color }} title={data.promptPreview || sessionLabel(data, t)}>
      <Handle type="target" position={Position.Top} className="sg-anchor" />
      <Avatar seed={data.id} status={data.status} size={34} title={`${sessionLabel(data, t)} · ${t(`status.${data.status}`)}`} />
      <span className="sg-label">{sessionLabel(data, t)}</span>
      <span className="sg-status" style={{ color: STATUS_COLOR[data.status] }}>{t(`status.${data.status}`)}</span>
      <Handle type="source" position={Position.Bottom} className="sg-anchor" />
    </div>
  )
}
const nodeTypes = { session: GraphNode }

// anchors an edge border-to-border by intersecting the centre-to-centre line with each node's rectangle
// (ported from ReactFlow's floating-edges example).
function nodeCenterIntersection(node, other) {
  const { width: w, height: h } = node.measured
  const p = node.internals.positionAbsolute
  const op = other.internals.positionAbsolute
  const hw = w / 2, hh = h / 2
  const cx = p.x + hw, cy = p.y + hh
  const ox = op.x + other.measured.width / 2, oy = op.y + other.measured.height / 2
  const xx = (ox - cx) / (2 * hw) - (oy - cy) / (2 * hh)
  const yy = (ox - cx) / (2 * hw) + (oy - cy) / (2 * hh)
  const a = 1 / (Math.abs(xx) + Math.abs(yy) || 1)
  return { x: hw * (a * xx + a * yy) + cx, y: hh * (-a * xx + a * yy) + cy }
}
function edgeSide(node, point) {
  const p = node.internals.positionAbsolute
  const { width, height } = node.measured
  if (Math.round(point.x) <= Math.round(p.x) + 1) return Position.Left
  if (Math.round(point.x) >= Math.round(p.x + width) - 1) return Position.Right
  if (Math.round(point.y) <= Math.round(p.y) + 1) return Position.Top
  return Position.Bottom
}
function FloatingEdge({ id, source, target, markerEnd, style, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius }) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  if (!sourceNode?.measured || !targetNode?.measured) return null
  const sp = nodeCenterIntersection(sourceNode, targetNode)
  const tp = nodeCenterIntersection(targetNode, sourceNode)
  const [path, labelX, labelY] = getBezierPath({
    sourceX: sp.x, sourceY: sp.y, sourcePosition: edgeSide(sourceNode, sp),
    targetX: tp.x, targetY: tp.y, targetPosition: edgeSide(targetNode, tp),
  })
  return (
    <BaseEdge
      id={id} path={path} markerEnd={markerEnd} style={style}
      label={label} labelX={labelX} labelY={labelY} labelStyle={labelStyle}
      labelShowBg={labelShowBg} labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding} labelBgBorderRadius={labelBgBorderRadius}
    />
  )
}
const edgeTypes = { floating: FloatingEdge }

// deterministic force-directed relaxation: seeded on a ring by sorted id (never Math.random) so the same
// topology always yields the same frame. `links` is the live [fromId, toId] pairs; direction is irrelevant.
function forceLayout(sessions, links) {
  const ids = sessions.map((s) => s.id).sort()
  const n = ids.length
  if (!n) return {}
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]))
  const K = 190                                  // ideal edge length: linked nodes settle ~this far apart
  const RCUT = K * 2.2                            // repulsion cutoff: beyond this two nodes stop shoving each
  //                                                other apart, so DISCONNECTED clusters don't fly to opposite
  //                                                corners (the classic Fruchterman-Reingold sprawl) — gravity
  //                                                then packs them back to ~RCUT apart, keeping the web compact.
  const ITER = 400, GRAV = 0.11                  // gravity: a centripetal pull so the whole web stays framed
  const seedR = K * Math.max(1, n / 8)
  const px = new Float64Array(n), py = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2
    px[i] = Math.cos(a) * seedR; py[i] = Math.sin(a) * seedR
  }
  const ls = links
    .map(([a, b]) => [idx[a], idx[b]])
    .filter(([a, b]) => a != null && b != null && a !== b)
  for (let it = 0; it < ITER; it++) {
    const temp = (1 - it / ITER) * K             // max step this round; cools to 0 for a settled frame
    const dx = new Float64Array(n), dy = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = px[i] - px[j], ey = py[i] - py[j]
        const d = Math.hypot(ex, ey) || 0.01
        if (d > RCUT) continue                   // far enough apart: no push, so clusters can't sprawl
        const rep = (K * K) / d
        ex /= d; ey /= d
        dx[i] += ex * rep; dy[i] += ey * rep
        dx[j] -= ex * rep; dy[j] -= ey * rep
      }
    }
    for (const [a, b] of ls) {
      let ex = px[a] - px[b], ey = py[a] - py[b]
      const d = Math.hypot(ex, ey) || 0.01
      const att = (d * d) / K
      ex /= d; ey /= d
      dx[a] -= ex * att; dy[a] -= ey * att
      dx[b] += ex * att; dy[b] += ey * att
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= px[i] * GRAV; dy[i] -= py[i] * GRAV   // gravity: keep the whole web centred and bounded
      const d = Math.hypot(dx[i], dy[i]) || 0.01
      const step = Math.min(d, temp)
      px[i] += (dx[i] / d) * step; py[i] += (dy[i] / d) * step
    }
  }
  const pos = {}
  ids.forEach((id, i) => { pos[id] = { x: Math.round(px[i]), y: Math.round(py[i]) } })
  return pos
}

function GraphCanvas({ sessions = [], onOpen, active, legend, setLegend, edges = [], edgesLoaded = false }) {
  const t = useT()
  const [pending, setPending] = useState([])         // optimistic monitor edges, awaiting the live watch
  const [toast, setToast] = useState(null)           // brief "asked A to monitor B" reassurance
  const [focusId, setFocusId] = useState(null)       // keyboard cursor: the node arrows move and ⏎ opens
  const [sourceSel, setSourceSel] = useState(null)   // monitor pick: the LEFT-clicked watcher awaiting a right-click target
  const { fitView, setCenter, getViewport } = useReactFlow()
  const framedRef = useRef(false)
  const [framed, setFramed] = useState(false)         // mask the pre-fit frame; reveal the already-centred web (no intro motion)
  const toastTimer = useRef(0)

  // the console's key listener mounts first and consumes ↑/↓/Esc; hjkl/⏎/? fall through to our nav effect below.

  const byId = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])
  // the links the force layout relaxes around: live monitor + comms edges whose BOTH ends are present
  // (the same "no edge touching a non-live session" rule the render applies). Direction is irrelevant to
  // layout — a link just means "pull these two together" — so monitor and comms count the same here.
  const linkPairs = useMemo(
    () => edges.filter((e) => byId[e.from] && byId[e.to] && e.from !== e.to).map((e) => [e.from, e.to]),
    [edges, byId],
  )
  // re-layout only when the node set or link set changes (sorted, so poll order-churn isn't a change).
  const topoKey = useMemo(() => {
    const ns = sessions.map((s) => s.id).slice().sort().join(',')
    const es = linkPairs.map(([a, b]) => `${a}~${b}`).sort().join(';')
    return `${ns}|${es}`
  }, [sessions, linkPairs])
  const pos = useMemo(() => forceLayout(sessions, linkPairs), [topoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const rfNodes = useMemo(() => sessions.map((s) => ({
    id: s.id, type: 'session', position: pos[s.id] || { x: 0, y: 0 },
    data: { ...s, focus: s.id === focusId, source: s.id === sourceSel }, draggable: true,
  })), [sessions, pos, focusId, sourceSel])

  // a live monitor A→B already registered drops its optimistic twin — the pending edge has become real.
  useEffect(() => {
    if (!pending.length) return
    const live = new Set(edges.filter((e) => e.kind !== 'comms').map((e) => `${e.from}->${e.to}`))
    setPending((p) => p.filter((e) => !live.has(`${e.from}->${e.to}`)))
  }, [edges]) // eslint-disable-line react-hooks/exhaustive-deps

  // each live monitor A→B is a solid directed arrow in the WATCHER's hue; each PENDING (asked-but-not-yet-
  // registered) monitor is the same arrow dashed, so the user sees their request land instantly and watches
  // it firm up when the real watch appears. Both keyed the same so a live edge supersedes its pending twin.
  const rfEdges = useMemo(() => {
    // an edge whose endpoint isn't in the preloaded node set (a brief board↔graph poll skew) is dropped —
    // the SAME "no edge touching a non-live session" rule the backend applies, kept honest client-side so
    // ReactFlow never routes a dangling arrow; it self-heals on the next board poll.
    const live = edges.filter((e) => byId[e.from] && byId[e.to]).map((e) => {
      // a COMMS edge (direct talk) reads APART from a monitor arrow: a thin, muted, UNDIRECTED dashed line
      // (no arrowhead) labelled with the message count — "these two have talked", distinct from "A watches B".
      if (e.kind === 'comms') {
        return {
          id: `comms:${e.from}-${e.to}`, source: e.from, target: e.to, type: 'floating',
          label: `💬 ${e.count ?? 1}`,
          labelStyle: { fontSize: 10, fill: 'var(--sg-comms, #8a8f98)', fontWeight: 600 },
          labelShowBg: true,
          labelBgStyle: { fill: 'var(--sg-comms-bg, rgba(20,22,28,0.85))' }, labelBgPadding: [4, 2], labelBgBorderRadius: 4,
          style: { stroke: 'var(--sg-comms, #8a8f98)', strokeWidth: 1.5, strokeDasharray: '2 4', opacity: 0.8 },
          className: 'sg-edge sg-comms',
        }
      }
      const stroke = labelColor(e.from)
      return {
        id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: 'floating', animated: true,
        style: { stroke, strokeWidth: 2 }, className: 'sg-edge',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      }
    })
    const liveIds = new Set(live.map((e) => e.id))
    const optimistic = pending.filter((e) => !liveIds.has(`${e.from}->${e.to}`)).map((e) => {
      const stroke = labelColor(e.from)
      return {
        id: `pending:${e.from}->${e.to}`, source: e.from, target: e.to, type: 'floating', animated: true,
        style: { stroke, strokeWidth: 2, strokeDasharray: '5 5', opacity: 0.7 }, className: 'sg-edge sg-pending',
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
      }
    })
    return [...live, ...optimistic]
  }, [edges, byId, pending])

  const flash = useCallback((text) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const askMonitor = useCallback((source, target) => {
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

  const onNodeClick = useCallback((_e, n) => {
    setFocusId(n.id)
    setSourceSel(n.id)
  }, [])
  const onNodeContextMenu = useCallback((e, n) => {
    e.preventDefault()
    if (!sourceSel) { flash(t('sessionGraph.needSource')); return }
    if (sourceSel === n.id) return
    askMonitor(sourceSel, n.id)
    setSourceSel(null)
  }, [sourceSel, askMonitor, t, flash])
  const onNodeDoubleClick = useCallback((_e, n) => { setSourceSel(null); onOpen?.(n.id) }, [onOpen])
  const onPaneClick = useCallback(() => setSourceSel(null), [])
  const onPaneContextMenu = useCallback((e) => { e.preventDefault?.(); setSourceSel(null) }, [])

  // keep a keyboard cursor alive: once the graph loads, focus the first node so arrows/⏎ have a start
  // point; if the focused session disappears between polls (closed/merged), fall back to the first node.
  useEffect(() => {
    if (!sessions.length) { if (focusId !== null) setFocusId(null); return }
    if (!focusId || !sessions.some((s) => s.id === focusId)) setFocusId(sessions[0].id)
  }, [sessions, focusId])

  // hjkl moves the cursor to the nearest node inside a 45° cone in that direction; pos is in flow coords
  // (the space setCenter wants), so no projection is needed.
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
      for (const s of sessions) {
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
  }, [active, byId, pos, sessions, CONES, onOpen, setCenter, getViewport, legend, setLegend])

  // framedRef flips inside the rAF, NOT in the effect body: under StrictMode the first run's rAF is cancelled
  // by its cleanup before it fires, so a body-side flag would make the surviving remount skip the reveal and
  // leave the canvas hidden. The mask is held until edgesLoaded so the first visible frame is the final web.
  useEffect(() => {
    if (!rfNodes.length) { setFramed(true); return }  // empty: show the bare board, nothing to frame
    if (!edgesLoaded) return                          // hold the mask until the live edges land (final layout)
    const first = !framedRef.current
    const id = requestAnimationFrame(() => {
      fitView({ padding: 0.25, duration: first ? 0 : 300 })
      framedRef.current = true
      setFramed(true)
    })
    return () => cancelAnimationFrame(id)
  }, [rfNodes.length, edgesLoaded, fitView])

  return (
    <>
      <ReactFlow
        nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu} onPaneClick={onPaneClick} onPaneContextMenu={onPaneContextMenu}
        nodesDraggable nodesConnectable={false} elementsSelectable={false}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }} minZoom={0.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        style={{ opacity: framed ? 1 : 0 }}
      >
        <Background variant="dots" color="#cdc6ad" gap={20} size={1} />
      </ReactFlow>
      {/* the pick hint is BOUND to the selection (sourceSel) — it stands while a node is picked and vanishes
          the instant the pick clears; it is NOT the timed toast (that is for the asked/needSource flashes). */}
      {sourceSel && <div className="sg-pick-hint">{t('sessionGraph.picked')}</div>}
      {toast && <div className="sg-toast">{toast}</div>}
    </>
  )
}

function SessionGraphLegend({ onClose }) {
  const t = useT()
  const KEYS = [
    [['h', 'j', 'k', 'l'], 'move'],
    [['⏎'], 'open'],
    [['←'], 'leave'],
  ]
  const MOUSE = [
    [t('sessionGraph.legend.gDblClick'), 'openMouse'],
    [t('sessionGraph.legend.gClickRight'), 'monitor'],
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
      </section>
      <section className="legend-sec">
        <div className="legend-h">{t('sessionGraph.legend.secMouse')}</div>
        {MOUSE.map(([gesture, descKey]) => (
          <div className="legend-row" key={descKey}>
            <span className="keymap-keys"><kbd>{gesture}</kbd></span>
            <span className="legend-desc">{t(`sessionGraph.legend.${descKey}`)}</span>
          </div>
        ))}
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

export default function SessionGraph({ sessions = [], onOpen, active = true, legend, setLegend, edges = [], edgesLoaded = false }) {
  const t = useT()
  return (
    <div className="session-graph">
      <div className="sg-hud">
        <button className="hud-help" onClick={() => setLegend((v) => !v)} title={t('sessionGraph.helpTitle')}>?</button>
      </div>
      <ReactFlowProvider>
        <GraphCanvas sessions={sessions} onOpen={onOpen} active={active} legend={legend} setLegend={setLegend} edges={edges} edgesLoaded={edgesLoaded} />
      </ReactFlowProvider>
      {legend && <SessionGraphLegend onClose={() => setLegend(false)} />}
    </div>
  )
}
