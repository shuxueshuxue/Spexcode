import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Handle, Position,
  MarkerType, ConnectionMode, useReactFlow,
  BaseEdge, getBezierPath, useInternalNode,
} from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { STATUS_COLOR, sessionHeadline } from './session.js'
import Modal from './Modal.jsx'
import { useT } from './i18n/index.jsx'

// @@@ session-graph - the EXPERIMENTAL directed monitor network: each session is a node, each LIVE
// monitor a directed arrow A→B meaning "agent A is right now running `spex watch B`". The NODES are the
// preloaded board sessions the dashboard already polls (passed in as `sessions`) — the same source every
// other surface reads — so the view opens INSTANTLY, never blocking on its own cold session fetch. Live
// edges are DERIVED from live watches (the `edges` of GET /api/sessions/graph), never stored. The view is OBSERVATIONAL — it
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

// a node's label is the SAME headline its session row/card/console title shows (sessionHeadline): a human
// rename, else the worker's LIVE tmux self-summary (`activity` — the agent's own description of what it's
// doing right now), else the launch-prompt preview, else node/title/branch. So a node here reads identically
// to that session everywhere else — never a divergent stable-id name. Only the bare-id fallback is the
// graph's own (short 8-char id), since a full id is too wide for a node chip.
const sessionLabel = (s, t) => {
  const h = sessionHeadline(s)
  return h && h !== s.id ? h : (s.id ? s.id.slice(0, 8) : t('common.session'))
}

// @@@ GraphNode - a session as a network node: its avatar + label, ringed in its own hue. The two handles
// are the drag targets for asking a monitor (the arrows themselves float border-to-border, see FloatingEdge,
// so they don't route through these handles). With connectionMode=loose (see ReactFlow below) EITHER handle
// of one node connects to EITHER of another, so a drag never fails just because two force-placed nodes face
// away from each other; direction (who watches whom) is the DRAG direction, not which handle was grabbed —
// drag from the watcher onto the watched.
function GraphNode({ data }) {
  const t = useT()
  const color = labelColor(data.id)
  // `focus` rings the node the keyboard targets: the one under the cursor, which ⏎ opens (see onNodeMouseEnter).
  return (
    <div className={`sg-node${data.focus ? ' sg-node--focus' : ''}`} style={{ '--sg': color }} title={data.promptPreview || sessionLabel(data, t)}>
      <Handle type="target" position={Position.Top} className="sg-handle" />
      <Avatar seed={data.id} status={data.status} size={34} title={`${sessionLabel(data, t)} · ${t(`status.${data.status}`)}`} />
      <span className="sg-label">{sessionLabel(data, t)}</span>
      <span className="sg-status" style={{ color: STATUS_COLOR[data.status] }}>{t(`status.${data.status}`)}</span>
      <Handle type="source" position={Position.Bottom} className="sg-handle" />
    </div>
  )
}
const nodeTypes = { session: GraphNode }

// @@@ FloatingEdge - an edge that anchors BORDER-TO-BORDER, not to the fixed Top/Bottom handles. In a
// force layout two nodes can settle in any direction from each other, so a handle-routed arrow would leave
// the bottom of one node to reach a node sitting to its LEFT — the tell-tale "naive graph" detour. Instead
// we intersect the straight line between the two node centres with each node's rectangle and draw a gentle
// bezier between those two boundary points, so every arrow leaves and lands cleanly whichever way the web
// settles. ReactFlow resolves edge.markerEnd/label into the props below before handing them here, so we just
// forward them to BaseEdge. (Geometry ported from ReactFlow's floating-edges example.)
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

// @@@ force-directed layout - a network relaxation, NOT a tree and NOT a fixed ring: every pair of nodes
// repels (a Coulomb push) and every live link (monitor or comms) pulls its two ends together (a Hooke
// spring), with a gentle gravity toward the origin so disconnected components stay framed. So linked
// sessions settle into CLUSTERS, unlinked ones drift to the margins, and the arrows stay short instead of
// slashing across a ring. Pure view concern, computed client-side (the backend serves topology, never
// pixels). DETERMINISTIC: nodes are seeded on a ring by SORTED id (never Math.random) and the sim runs a
// fixed cooling schedule to a settled frame, so the same topology always yields the same picture — and the
// caller recomputes it ONLY when the topology (node set or link set) changes, so the web never jitters
// across the 4s edge polls. `links` is the live [fromId, toId] pairs; direction doesn't matter for layout.
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
  // @@@ nodes AND edges in hand on the first render - the graph's NODES are the SHARED session list the
  // dashboard already polls (`board.sessions`, refreshed every 4s by App), and its EDGES (the live monitor +
  // comms network) are polled by the always-mounted CONSOLE and handed down as a prop too — NOT cold-fetched
  // here. So both halves are present on the first paint: the layout is the FINAL force-clustered web from the
  // start, never an edgeless placeholder that re-settles a few seconds later (the old self-poll lived in this
  // remount-on-reselect component, so every entry flashed nodes-only then jumped when the first poll landed).
  // `edgesLoaded` (the console's first edge response landed, even an empty one) gates the reveal so the first
  // VISIBLE frame already carries the relationships. Pending/optimistic edges are interaction state, so they
  // stay local here.
  const [pending, setPending] = useState([])         // optimistic monitor edges, awaiting the live watch
  const [toast, setToast] = useState(null)           // brief "asked A to monitor B" reassurance
  const [focusId, setFocusId] = useState(null)       // keyboard cursor: the node arrows move and ⏎ opens
  const { fitView, setCenter, getViewport } = useReactFlow()
  const framedRef = useRef(false)
  const [framed, setFramed] = useState(false)         // mask the pre-fit frame; reveal the already-centred web (no intro motion)
  const toastTimer = useRef(0)

  // The CONSOLE owns the universal keys (↑/↓ walk the tab list, Esc closes the console/this legend). What's
  // LEFT to this view — handled in the nav effect below — is the in-graph nav: hjkl move the cursor, ⏎ opens
  // the focused session, `?` toggles the legend. The console's window listener runs FIRST (it mounts first)
  // and consumes ↑/↓/Esc; the keys it doesn't touch (hjkl/⏎/?) fall through to ours.

  const byId = useMemo(() => Object.fromEntries(sessions.map((s) => [s.id, s])), [sessions])
  // the links the force layout relaxes around: live monitor + comms edges whose BOTH ends are present
  // (the same "no edge touching a non-live session" rule the render applies). Direction is irrelevant to
  // layout — a link just means "pull these two together" — so monitor and comms count the same here.
  const linkPairs = useMemo(
    () => edges.filter((e) => byId[e.from] && byId[e.to] && e.from !== e.to).map((e) => [e.from, e.to]),
    [edges, byId],
  )
  // @@@ re-relax only on topology change - the layout is a settled frame, not a live animation, so we
  // recompute it ONLY when the node set or the link set actually changes, keyed off this string. Across the
  // 4s edge polls that return the same shape the memo is reused and the web sits perfectly still — no jitter,
  // no re-seed — exactly the stillness the spec promises; a started/stopped watch or a new/closed session
  // re-lays it out once. (Sorted so order-only churn in the poll never counts as a change.)
  const topoKey = useMemo(() => {
    const ns = sessions.map((s) => s.id).slice().sort().join(',')
    const es = linkPairs.map(([a, b]) => `${a}~${b}`).sort().join(';')
    return `${ns}|${es}`
  }, [sessions, linkPairs])
  const pos = useMemo(() => forceLayout(sessions, linkPairs), [topoKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const rfNodes = useMemo(() => sessions.map((s) => ({
    id: s.id, type: 'session', position: pos[s.id] || { x: 0, y: 0 },
    data: { ...s, focus: s.id === focusId }, draggable: true,
  })), [sessions, pos, focusId])

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
    if (!sessions.length) { if (focusId !== null) setFocusId(null); return }
    if (!focusId || !sessions.some((s) => s.id === focusId)) setFocusId(sessions[0].id)
  }, [sessions, focusId])

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

  // @@@ frame BEFORE the first visible frame, on the FINAL layout - the web is origin-centred in flow coords,
  // so its very first paint lands in the top-left corner at the default zoom. We keep the canvas hidden
  // (opacity 0, see the ReactFlow style) through that first paint, then in the rAF fit the web AND reveal it in
  // the same commit — so the first VISIBLE frame is already centred and STATIC, never an intro animation. The
  // reveal is also HELD until `edgesLoaded` (the console's first edge response has landed): nodes are preloaded
  // but the force layout clusters around the live edges, so revealing before they arrive would show the
  // edgeless placeholder and then JUMP when the topology lands. Gating on edgesLoaded means the masked frame
  // we finally fit-and-reveal already carries the relationships — the final clustered web, no shuffle. An empty
  // board reveals at once (nothing to frame). A later session-count change reframes with a gentle pan (300ms,
  // already visible); a topology change re-settles the nodes in place without a reframe (length-keyed deps).
  // framedRef flips inside the rAF, NOT in the effect body: under StrictMode the first effect run's rAF is
  // cancelled by its cleanup before it fires, so a body-side flag would make the surviving remount read
  // "not first" and skip the reveal (canvas stuck hidden). Setting it only when the rAF actually runs keeps
  // the instant first-fit + reveal correct in dev and prod alike.
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
        onConnect={onConnect} onConnectStart={onConnectStart} onNodeClick={onNodeClick}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable nodesConnectable connectOnClick={false} elementsSelectable={false}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }} minZoom={0.3} maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        style={{ opacity: framed ? 1 : 0 }}
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
// `sessions` is the preloaded board session list (the console already holds it) — the graph's NODES, so the
// view opens instantly without a cold listSessions() fetch. `edges`/`edgesLoaded` are the live monitor+comms
// network the CONSOLE polls and hands down (so they persist across this tab's remount-on-reselect and stay
// current in the background) — see GraphCanvas; the view never polls them itself.
export default function SessionGraph({ sessions = [], onOpen, active = true, legend, setLegend, edges = [], edgesLoaded = false }) {
  const t = useT()
  return (
    <div className="session-graph">
      {/* a single discreet `?` — the same help affordance the spec board uses — opens the keymap/edge legend.
          No brand/back chrome: the tab IS the frame, and leaving is just picking another tab. */}
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
