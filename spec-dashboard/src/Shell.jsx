import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import StatusBar, { useStatusItem } from './StatusBar.jsx'
import TabStrip, { placeLabel } from './TabStrip.jsx'
import Dock from './Dock.jsx'
import SpecSearch from './SpecSearch.jsx'
import ViewErrorBoundary from './ViewErrorBoundary.jsx'
import { useRoute, navigate, routeHash } from './route.js'
import { useT } from './i18n/index.jsx'
import { PaneProvider, useBoard, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { viewFor } from './views.jsx'
import { useResizable } from './useResizable.js'
import { Icon } from './icons.jsx'
import ContextDock from './ContextDock.jsx'
import { useKeyboardScope } from './KeyboardService.jsx'
import { firesEvent, firesKey } from './bindings.js'
import { pinTab, runTabCommand } from './tabs.js'

// [[workspace-shell]]: the frame. Rail, dock, tab strip, content area, status bar — and nothing else.
//
// It is deliberately ignorant: it does not know what a spec is, what a session is, or what any view needs.
// It knows there is an address, that an address names a view, and where on the screen that view goes. Every
// piece of knowledge it does not have is a piece a view could not previously own, because the component
// that held the frame also held every page's state.
//
// The shell is the ONLY component that reads the global address. A view receives its route as props, which
// is the rule that makes two-up possible later and that keeps a view from coupling to whichever address
// happens to be current.

// THE SIDEBAR IS A PROPERTY OF THE FOCUSED TAB ([[dock-modes]]) — which projection it shows, and whether
// it exists at all. A session document belongs with the session list; a node or a governed file belongs
// with the explorer. The singleton boards have NO natural sidebar, so they render none and the main area
// takes the whole width: a board must not inherit the previous tab's dock, because inheriting it is what
// makes a sidebar feel like a setting the reader is maintaining instead of a fact about what they hold.
// `keep` is the third answer — the graph and the empty workspace have no opinion and change nothing.
const SIDEBARLESS = new Set(['evals', 'issues', 'settings'])
const dockFor = (page) => {
  if (SIDEBARLESS.has(page)) return 'none'
  if (page === 'sessions') return 'sessions'
  if (page === 'spec' || page === 'file') return 'explorer'
  return 'keep'
}

// WHAT COUNTS AS "THE SAME MOUNTED DOCUMENT". Most views are one per address. Two are one per PAGE,
// because they hold their object internally and re-mounting them per object throws away the very thing
// they exist to keep warm: the graph's camera and expansion are the workspace's state rather than one
// address's, and the session console holds every live terminal's socket and scrollback behind its own
// layers ([[session-console]]) — keying it per session id is what made every session switch a cold boot.
const POOL_PAGES = new Set(['graph', 'sessions'])
const poolKey = (page, param) => (POOL_PAGES.has(page) ? page : `${page}/${param ?? ''}`)
// How many documents stay mounted. Small enough that an idle workspace is idle, large enough that the tab
// strip's usual working set is entirely warm — a bound that fits the strip, not a guess about memory.
const POOL_LIMIT = 6
// mirrors --dur-panel in the stylesheet: the shell has to outlive the CSS animation by the same amount it
// lasts, and one of the two has to name the number.
const DOCK_ANIMATION_MS = 170

// [[workspace-shell]]'s MOUNTED-DOCUMENT POOL. Switching tabs used to remount the document from scratch —
// every switch re-ran a view's whole boot, which is what "why does clicking a tab reload it" was naming.
// A pool keeps the recent documents mounted and shows one; the others are display-hidden, exactly as the
// session console has always kept its terminals ([[session-console]]'s warm layers). Nothing is unmounted
// until the pool is over its limit, and then the least recently shown one goes.
//
// RENDER ORDER IS INSERTION ORDER, never recency. Reordering keyed children moves real DOM nodes, and a
// moved node re-attaches its iframes and canvases — which is a reload wearing a different name. Recency
// lives in a counter used only to pick the victim.
function ViewPool({ page, param, query }) {
  const key = poolKey(page, param)
  const address = routeHash(page, param, query)
  const seq = useRef(0)
  const [pool, setPool] = useState(() => [{ key, address, page, param, query, seq: 0 }])
  useEffect(() => {
    setPool((prev) => {
      const stamp = ++seq.current
      const held = prev.find((entry) => entry.key === key)
      // an entry that is shown again takes the CURRENT route: a pool keyed by page (the console) is one
      // instance being handed a new object, which is the whole point of keying it that way.
      let next = held
        ? prev.map((entry) => (entry.key === key ? { ...entry, address, page, param, query, seq: stamp } : entry))
        : [...prev, { key, address, page, param, query, seq: stamp }]
      if (next.length > POOL_LIMIT) {
        const victim = next.reduce((oldest, entry) => (entry.seq < oldest.seq ? entry : oldest))
        next = next.filter((entry) => entry !== victim)
      }
      return next
    })
  }, [key, address])
  return pool.map((entry) => <PoolPane key={entry.key} entry={entry} showing={entry.key === key} />)
}

// One mounted document. It is MEMOISED, and that is not a micro-optimization: the shell re-renders on
// every board push, and without this each push would re-render every document in the pool — the idle cost
// of a workspace would scale with how many tabs the reader keeps, which is the one thing a pool must not
// do. Pane props are stable between route changes, so a hidden pane re-renders only when it is shown or
// its address moves. Its other half is the frozen board a hidden pane reads ([[workspace-shell]]).
const PoolPane = memo(function PoolPane({ entry, showing }) {
  const t = useT()
  const { component: View, className } = viewFor(entry.page)
  const pane = useMemo(() => ({ address: entry.address, active: showing }), [entry.address, showing])
  return (
    <div className={`viewhost ${className}`} aria-hidden={showing ? undefined : 'true'}
      style={showing ? undefined : { display: 'none' }}>
      {/* the boundary wraps the whole host, Suspense included, so a lazy chunk that will not load is
          contained the same way a render that throws is. The address resets it: leaving a broken
          document is the reader's own recovery, and it must not need a reload. */}
      <ViewErrorBoundary resetKey={entry.address}>
        <PaneProvider value={pane}>
          <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
            <View param={entry.param} query={entry.query} />
          </Suspense>
        </PaneProvider>
      </ViewErrorBoundary>
    </div>
  )
})

// The SECOND pane is not a pool. It holds one document the reader deliberately sent there, so it is the
// one place where keying on the address is the whole contract — there is no browsing history to keep warm.
function ViewHost({ page, param, query }) {
  const t = useT()
  const { component: View, className } = viewFor(page)
  const address = routeHash(page, param, query)
  return (
    <div className={`viewhost ${className}`}>
      <ViewErrorBoundary resetKey={address}>
        <PaneProvider value={{ address, active: true }}>
          <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
            <View key={poolKey(page, param)} param={param} query={query} />
          </Suspense>
        </PaneProvider>
      </ViewErrorBoundary>
    </div>
  )
}

// The shell's own status contribution: the workspace identity.
function ShellStatus() {
  const { identity } = useBoard()
  // workspace identity: which project this window is looking at. It belongs to the shell because it is
  // true of the window, not of whatever view happens to be showing. The dock toggle moved to the rail
  // ([[side-nav]]) — the finding controls live together, and one control has one owner.
  useStatusItem({ id: 'project', side: 'left', priority: 1000, kind: 'prominent', text: `$ ${identity?.title || 'spexcode'}` })
  return null
}

// One view, or two. The second is a second route and a place to put it — nothing in any view changes,
// because a view was already receiving its route rather than reading it. That is the whole return on the
// hinge: two-up stopped being a rewrite and became a layout.
function Content({ page, param, query }) {
  const t = useT()
  const { split } = useWorkspace()
  const { closeSplit } = useWorkspaceApi()
  const [width, onDrag, reset] = useResizable('spex.splitWidth', 620, { min: 320, max: 1400, dir: -1 })
  if (!split) return <ViewPool page={page} param={param} query={query} />
  return (
    <div className="content-split">
      <ViewHost page={page} param={param} query={query} />
      <div className="content-divider" onMouseDown={onDrag} onDoubleClick={reset}
        role="separator" aria-orientation="vertical" />
      <div className="content-second" style={{ width }}>
        <button type="button" className="content-close" onClick={closeSplit} aria-label={t('tabs.close')}>
          <Icon name="x" size={12} />
        </button>
        <ViewHost page={split.page} param={split.param} query={split.query} />
      </div>
    </div>
  )
}

function ContextToggle({ visible, onToggle }) {
  const t = useT()
  return <button type="button" className={`context-toggle${visible ? ' on' : ''}`} onClick={onToggle}
    aria-label={t(visible ? 'contextDock.close' : 'contextDock.open')} data-tip={t(visible ? 'contextDock.close' : 'contextDock.open')}>
    <Icon name="panel-right" size={14} />
  </button>
}

export default function Shell() {
  const t = useT()
  const { page, param, query } = useRoute()
  const { specs, sessions, identity, catalog, graphOnly } = useBoard()
  const { dock, dockMode, palette } = useWorkspace()
  const { closePalette, openPalette, setDock, setDockMode, splitTo } = useWorkspaceApi()
  const [contextOpen, setContextOpen] = useState(() => {
    try { return localStorage.getItem('spexcode.ctxOpen') !== '0' } catch { return true }
  })
  const toggleContext = () => setContextOpen((value) => {
    const next = !value
    try { localStorage.setItem('spexcode.ctxOpen', next ? '1' : '0') } catch {}
    return next
  })

  // THE DOCK FOLLOWS THE FOCUSED TAB. The projection is derived from what the reader is holding, not
  // chosen once and left behind: moving to a session tab brings the session list, moving to a node or a
  // governed file brings the explorer, and a sidebar-less board renders no dock at all. A rail click still
  // selects a projection by hand — that override simply lasts until the reader moves to another DOCUMENT,
  // which is what makes it an override rather than a second setting. The effect is keyed on the document,
  // not the address, so switching a session's own face is not a focus change.
  const dockKind = dockFor(page)
  const documentKey = `${page}/${param ?? ''}`
  // Closing is a MOVEMENT, so the dock outlives the state that hides it by exactly one panel duration and
  // slides out ([[dock-modes]]). One timer, cleared on reopen; the reader can never end up with a ghost
  // panel, because the flag only ever survives its own timeout.
  const [closingDock, setClosingDock] = useState(false)
  const wasDocked = useRef(dock)
  useEffect(() => {
    if (wasDocked.current === dock) return undefined
    wasDocked.current = dock
    if (dock) { setClosingDock(false); return undefined }
    setClosingDock(true)
    const timer = setTimeout(() => setClosingDock(false), DOCK_ANIMATION_MS)
    return () => clearTimeout(timer)
  }, [dock])
  useEffect(() => {
    if (dockKind === 'sessions' || dockKind === 'explorer') setDockMode(dockKind)
  }, [documentKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // The browser tab is a positioning signal, not a brand plate. The shell is the only component that reads
  // the address, so it is the only one that can say WHERE the reader is; the project keeps the suffix, so a
  // window still says which workspace it belongs to when several are open side by side.
  const place = placeLabel({ page, param, query }, { specs, sessions, t })
  useEffect(() => {
    document.title = `${place} · ${identity?.title || 'spexcode'}`
  }, [place, identity?.title])

  const onShellKey = useCallback((event) => {
    // A palette is a true overlay. Escape closes it here; all other keys remain available to its input.
    if (palette) {
      if (event.key === 'Escape') { event.preventDefault(); closePalette(); return true }
      return false
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.closest?.('button, a[href], input, select, textarea, summary')) return false
    // [[keyboard-nav]]'s native-control restraint, kept across the hoist to the shell scope: while real
    // DOM focus sits in a typing context — an input, a textarea (the session composer, xterm's helper),
    // anything contenteditable — every UNMODIFIED key belongs to that control. A bare comma must type a
    // comma, never navigate to settings. Modifier-carrying chords (the ⌥ page jumps) still pass.
    if (!event.altKey && !event.ctrlKey && !event.metaKey
      && event.target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      const pageOf = [
        ['shell.pageSessions', 'sessions'], ['shell.pageEvals', 'evals'],
        ['shell.pageIssues', 'issues'], ['shell.pageSettings', 'settings'],
      ]
      const target = pageOf.find(([id]) => firesEvent(id, event))?.[1]
      if (target) {
        event.preventDefault(); closePalette()
        // the keyboard twin of the rail button, so it is the same create-or-focus: a singleton board is
        // held, not spent through the current slot. The sealed face has one view and no destinations.
        if (!graphOnly) pinTab(target)
        return true
      }
      if (!graphOnly && firesEvent('shell.newSession', event)) { event.preventDefault(); navigate('sessions', 'new'); return true }
      if (!graphOnly && firesEvent('shell.evals', event)) { event.preventDefault(); closePalette(); pinTab('evals'); return true }
      if (!graphOnly && firesEvent('shell.search', event)) { event.preventDefault(); openPalette('sessions'); return true }
    }
    if (firesEvent('shell.dockToggle', event)) { event.preventDefault(); setDock((value) => !value); return true }
    if (firesEvent('shell.dockMode', event)) { event.preventDefault(); setDockMode(dockMode === 'explorer' ? 'sessions' : 'explorer'); return true }
    if (!graphOnly && firesEvent('shell.contextToggle', event)) { event.preventDefault(); toggleContext(); return true }
    if (!graphOnly && firesEvent('shell.tabClose', event)) { event.preventDefault(); runTabCommand('closeActive'); return true }
    if (!graphOnly && firesEvent('shell.tabNext', event)) { event.preventDefault(); runTabCommand('move', 1); return true }
    if (!graphOnly && firesEvent('shell.tabPrevious', event)) { event.preventDefault(); runTabCommand('move', -1); return true }
    if (!graphOnly && firesEvent('shell.tabSplit', event)) {
      event.preventDefault(); const active = runTabCommand('active'); if (active) splitTo(active); return true
    }
    // Settings is a shell destination even when the graph view is not mounted. The graph keeps its own
    // rebindable slash/info verbs; this global fallback is what restores comma on every routed surface.
    // Leaving settings lands on sessions — the workspace's daily face, and the same place an unknown
    // address resolves to now that the graph is only an address ([[node-graph]]).
    if (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.settings', event.key)) {
      event.preventDefault()
      if (page === 'settings') navigate('sessions'); else pinTab('settings')
      return true
    }
    if (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.search', event.key)) {
      event.preventDefault(); openPalette('nodes'); return true
    }
    return false
  }, [closePalette, dockMode, graphOnly, openPalette, page, palette, setDock, setDockMode, splitTo, contextOpen])
  useKeyboardScope(onShellKey, -100)

  // The public artifact is one sealed reading surface: no dock, no tabs, no palette, one view.
  if (graphOnly) {
    return (
      <div className="app-shell">
        <div className="app">
          <TooltipLayer />
          <div className="app-main"><ViewHost page="graph" param={param} query={query} /></div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="app">
        <TooltipLayer />
        <SideBar page={page} identity={identity} catalog={catalog} />
        {(dock || closingDock) && dockKind !== 'none' && (
          <ViewErrorBoundary resetKey="dock">
            <Dock closing={closingDock} mode={dockMode} specs={specs} sessions={sessions}
              focusId={page === 'spec' ? param : null} activeSessionId={page === 'sessions' ? param : null} />
          </ViewErrorBoundary>
        )}
        <div className="app-main">
          {/* the strip IS the band — it used to be wrapped in a spacer that stood in for it on every route
              without an open document, which is one band wearing two names. The context toggle is a control
              on the current document, so it rides the strip's own trailing cluster. */}
          <TabStrip specs={specs} sessions={sessions} route={{ page, param, query }}
            trailing={page === 'spec' ? <ContextToggle visible={contextOpen} onToggle={toggleContext} /> : null} />
          <Content page={page} param={param} query={query} />
        </div>
        <ContextDock page={page} param={param} open={contextOpen} onToggle={toggleContext} />
      </div>
      <ShellStatus />
      <StatusBar />
      {/* the one shared palette: it floats above whichever view is showing, so it is the shell's. A view
          being hidden must never be able to swallow it — the reason it was hoisted here in the first place. */}
      {palette && (
        <SpecSearch specs={specs} sessions={sessions} boost={palette === 'sessions' ? 'session' : null}
          onClose={closePalette}
          onPick={(hit) => { closePalette(); if (hit?.hash) location.hash = hit.hash; else if (hit?.id) navigate('spec', hit.id) }} />
      )}
      <span className="sr-only">{t('nav.railLabel')}</span>
    </div>
  )
}
