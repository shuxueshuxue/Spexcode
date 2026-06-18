import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import SpecNode from './SpecNode.jsx'
import NodeView, { PANES } from './NodeView.jsx'
import { loadSpecs } from './data.js'

const nodeTypes = { spec: SpecNode }
const NW = 180, NH = 26
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
  const [pane, setPane] = useState('work')
  const { getViewport, setViewport } = useReactFlow()
  const graphRef = useRef(null)
  const animRef = useRef(0)

  const byId = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [])
  const focus = byId[focusId]

  const siblings = useMemo(() => specs.filter((s) => s.parent === focus.parent).sort((a, b) => a.y - b.y), [focus])
  const children = useMemo(() => specs.filter((s) => s.parent === focus.id), [focus])
  const parent = focus.parent ? byId[focus.parent] : null
  const sibIdx = siblings.findIndex((s) => s.id === focus.id)
  const trail = useMemo(() => {
    const a = []; let p = focus
    while (p) { a.unshift(p); p = p.parent ? byId[p.parent] : null }
    return a
  }, [focus]) // eslint-disable-line

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
  }, [focus])
  const downTarget = useMemo(() => nearestY('down'), [nearestY])
  const upTarget    = useMemo(() => nearestY('up'), [nearestY])

  // @@@ onNav - same tree-walk the keyboard does, but driven from the overlay's terminal input
  // (its empty command line forwards ←/→ parent/child, ↑/↓ siblings). Keeps the overlay open.
  const onNav = useCallback((dir) => {
    const t = { up: upTarget, down: downTarget, parent, child: childTarget }[dir]
    if (t) setFocusId(t.id)
  }, [upTarget, downTarget, parent, childTarget])

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
        if (pane === 'work') return // work pane's command line owns the keys; it walks the tree via onNav
        if (['1', '2', '3'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setPane(PANE_KEYS[+e.key - 1]); return }
        if (e.key === 'ArrowUp')    return go(upTarget, e)
        if (e.key === 'ArrowDown')  return go(downTarget, e)
        if (e.key === 'ArrowLeft')  return go(parent, e)
        if (e.key === 'ArrowRight') return go(childTarget, e)
        return
      }
      if (e.key === 'ArrowUp')    return go(upTarget, e)
      if (e.key === 'ArrowDown')  return go(downTarget, e)
      if (e.key === 'ArrowLeft')  return go(parent, e)
      if (e.key === 'ArrowRight') return go(childTarget, e)
      if (e.key === '=' || e.key === '+') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom * 1.2), 160) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); centerOn(focus, clamp(getViewport().zoom / 1.2), 160) }
      else if (e.key === '0') { e.preventDefault(); centerOn(focus, 0.85, 200) }
      else if (e.key === 'Enter') { e.preventDefault(); setOverlay(true) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, pane, focus, upTarget, downTarget, childTarget, parent, centerOn, getViewport])

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
            <span><kbd>↑</kbd><kbd>↓</kbd> siblings</span>
            <span><kbd>←</kbd> parent</span>
            <span><kbd>→</kbd> child</span>
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

      {overlay && <NodeView node={focus} pane={pane} setPane={setPane} onClose={() => setOverlay(false)} onNav={onNav} />}
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
