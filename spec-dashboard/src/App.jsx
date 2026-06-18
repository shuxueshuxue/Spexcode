import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { PANES } from './NodeView.jsx'
import { loadSpecs } from './data.js'

const nodeTypes = { spec: SpecNode }
const NW = 200, NH = 145
const PANE_KEYS = PANES.map((p) => p.key)
const clamp = (z) => Math.max(0.4, Math.min(1.6, z))

const STATUS_TEXT = {
  merged:  'merged · decided & landed',
  active:  'active · live session',
  pending: 'pending · not built yet',
}

function Dashboard({ specs }) {
  const [focusId, setFocusId] = useState(() => specs.find((s) => !s.parent)?.id)
  const [overlay, setOverlay] = useState(false)
  const [pane, setPane] = useState('spec')
  const { getViewport, setViewport } = useReactFlow()
  const graphRef = useRef(null)
  const animRef = useRef(0)

  const byId = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [])
  const focus = byId[focusId]

  const siblings = useMemo(() => specs.filter((s) => s.parent === focus.parent), [focus])
  const children = useMemo(() => specs.filter((s) => s.parent === focus.id), [focus])
  const parent = focus.parent ? byId[focus.parent] : null
  const sibIdx = siblings.findIndex((s) => s.id === focus.id)
  const trail = useMemo(() => {
    const a = []; let p = focus
    while (p) { a.unshift(p); p = p.parent ? byId[p.parent] : null }
    return a
  }, [focus]) // eslint-disable-line

  const downTarget = useMemo(() => {
    if (!children.length) return null
    return children.reduce((best, c) => (Math.abs(c.x - focus.x) < Math.abs(best.x - focus.x) ? c : best))
  }, [children, focus])

  // @@@ horizontal nav - prefer a sibling on that side; if none, jump to the spatially nearest
  // node in that direction across the whole tree (Δx weighted, Δy as tie-break). Reversible on
  // a tidy tree because each subtree owns a contiguous x-band.
  const nearestX = useCallback((dir) => {
    const score = (s) => Math.abs(s.x - focus.x) * 2 + Math.abs(s.y - focus.y)
    let best = null
    for (const s of specs) {
      const dx = s.x - focus.x
      if (s.id === focus.id || (dir === 'right' ? dx <= 0 : dx >= 0)) continue
      if (!best || score(s) < score(best)) best = s
    }
    return best
  }, [focus])
  const rightTarget = useMemo(() => (sibIdx < siblings.length - 1 ? siblings[sibIdx + 1] : nearestX('right')), [siblings, sibIdx, nearestX])
  const leftTarget  = useMemo(() => (sibIdx > 0 ? siblings[sibIdx - 1] : nearestX('left')), [siblings, sibIdx, nearestX])

  // stable nodes — positions from data, never recomputed; only selected + dim toggle.
  const nodes = useMemo(() => specs.map((s) => {
    const kin = s.id === focusId || s.id === focus.parent || s.parent === focusId || s.parent === focus.parent
    return {
      id: s.id, type: 'spec', position: { x: s.x, y: s.y }, data: s,
      draggable: false, selected: s.id === focusId, className: kin ? undefined : 'is-far',
    }
  }), [focusId, focus.parent])

  const edges = useMemo(() => specs.filter((s) => s.parent).map((s) => {
    const hot = s.id === focusId || s.parent === focusId
    return {
      id: `${s.parent}-${s.id}`, source: s.parent, target: s.id, type: 'smoothstep',
      style: { stroke: hot ? '#268bd2' : '#ded7bf', strokeWidth: hot ? 2 : 1 }, zIndex: hot ? 1 : 0,
    }
  }), [focusId])

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

  // @@@ keys - capture phase so we win over xterm/react-flow. Graph mode navigates the tree;
  // overlay mode switches panes (tab / 1-4) and, in non-terminal panes, still walks the tree.
  useEffect(() => {
    const cyclePane = (dir) => setPane((p) => PANE_KEYS[(PANE_KEYS.indexOf(p) + dir + PANE_KEYS.length) % PANE_KEYS.length])
    const go = (t, e) => { if (t) { e.preventDefault(); e.stopPropagation(); setFocusId(t.id) } }
    const onKey = (e) => {
      if (overlay) {
        if (e.key === 'Escape') { e.preventDefault(); setOverlay(false); return }
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); cyclePane(e.shiftKey ? -1 : 1); return }
        if (pane === 'term') return // terminal owns the rest of the keyboard
        if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setPane(PANE_KEYS[+e.key - 1]); return }
        if (e.key === 'ArrowLeft')  return go(leftTarget, e)
        if (e.key === 'ArrowRight') return go(rightTarget, e)
        if (e.key === 'ArrowDown')  return go(downTarget, e)
        if (e.key === 'ArrowUp')    return go(parent, e)
        return
      }
      if (e.key === 'ArrowLeft')  return go(leftTarget, e)
      if (e.key === 'ArrowRight') return go(rightTarget, e)
      if (e.key === 'ArrowDown')  return go(downTarget, e)
      if (e.key === 'ArrowUp')    return go(parent, e)
      if (e.key === '=' || e.key === '+') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (e.key === '0') { e.preventDefault(); centerOn(focus, 0.85, 200) }
      else if (e.key === 'Enter') { e.preventDefault(); setOverlay(true) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, pane, focus, leftTarget, rightTarget, downTarget, parent, centerOn, getViewport])

  const onNodeClick = useCallback((_e, n) => setFocusId(n.id), [])

  // @@@ global stats - whole-tree rollup, independent of focus.
  const stats = useMemo(() => {
    const by = { merged: 0, active: 0, pending: 0 }
    let sessions = 0, versions = 0
    for (const s of specs) { by[s.status]++; if (s.session) sessions++; versions += s.version }
    return { total: specs.length, ...by, sessions, versions }
  }, [])

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
            <span><kbd>←</kbd><kbd>→</kbd> across</span>
            <span><kbd>↑</kbd> parent</span>
            <span><kbd>↓</kbd> child</span>
            <span><kbd>+</kbd><kbd>-</kbd> zoom</span>
            <span><kbd>⏎</kbd> open · <kbd>esc</kbd> back</span>
          </div>
        </div>
      </div>

      <aside className="side">
        <h2>// global</h2>
        <div className="stats">
          <div><span>specs</span><b>{stats.total}</b></div>
          <div><span>merged</span><b className="c-merged">{stats.merged}</b></div>
          <div><span>active</span><b className="c-active">{stats.active}</b></div>
          <div><span>pending</span><b className="c-pending">{stats.pending}</b></div>
          <div><span>live sessions</span><b>{stats.sessions}</b></div>
          <div><span>total versions</span><b>{stats.versions}</b></div>
        </div>

        <h2>// focused</h2>
        <nav className="trail">
          {trail.map((t, i) => (
            <span key={t.id}>
              {i > 0 && <span className="sep">/</span>}
              <button className={t.id === focusId ? 'crumb here' : 'crumb'} onClick={() => setFocusId(t.id)}>{t.title}</button>
            </span>
          ))}
        </nav>

        <h1>{focus.title}</h1>
        <div className={`badge ${focus.status}`}>[{STATUS_TEXT[focus.status]}]</div>
        <p className="desc">{focus.desc}</p>

        <div className="meta">
          <div><span>version</span><b>{focus.version || '—'}</b></div>
          <div><span>session</span><b>{focus.session || 'idle'}</b></div>
          <div><span>worktree</span><b>{focus.session ? `node/${focus.id}` : 'main'}</b></div>
          <div><span>sibling</span><b>{sibIdx + 1} / {siblings.length}</b></div>
          <div><span>children</span><b>{children.length || '—'}</b></div>
        </div>

        <button className="peek-btn" onClick={() => setOverlay(true)}>
          {focus.session ? '⏎  resume live session' : '⏎  open node'}
        </button>
      </aside>

      {overlay && <NodeView node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} />}
    </div>
  )
}

// @@@ App - loads the spec tree from the backend, then renders the dashboard.
export default function App() {
  const [specs, setSpecs] = useState(null)
  useEffect(() => { loadSpecs().then(setSpecs) }, [])
  if (!specs) return <div className="loading">loading specs from git…</div>
  return <Dashboard specs={specs} />
}
