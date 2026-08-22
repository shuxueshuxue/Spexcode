import { Suspense, useCallback, useState } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import StatusBar, { useStatusItem } from './StatusBar.jsx'
import TabStrip from './TabStrip.jsx'
import Dock from './Dock.jsx'
import SpecSearch from './SpecSearch.jsx'
import ViewErrorBoundary from './ViewErrorBoundary.jsx'
import { useRoute, navigate } from './route.js'
import { useT } from './i18n/index.jsx'
import { useBoard, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { viewFor } from './views.jsx'
import { useResizable } from './useResizable.js'
import { Icon } from './icons.jsx'
import ContextDock from './ContextDock.jsx'
import { useKeyboardScope } from './KeyboardService.jsx'
import { firesEvent, firesKey } from './bindings.js'
import { runTabCommand } from './tabs.js'

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

// The wide boards are the one place the FINDING region stands down. Evals and Issues are finding surfaces
// in their own right — full-width GitHub-style lists with their own query, facets and rows — so putting the
// dock beside one puts two finding surfaces on screen at once and squeezes the board the width it was
// designed around. While a board is routed the dock does not render at all. The rail's projection buttons
// still own the stored PREFERENCE (and stay lit only when their projection is active): the board suppresses
// the dock for as long as it is the document, and never edits what the reader chose.
const BOARD_PAGES = new Set(['evals', 'issues'])

function ViewHost({ page, param, query }) {
  const t = useT()
  const { component: View, className } = viewFor(page)
  // keyed on the address: a different document is a different instance, so one document's state can never
  // bleed into the next. Views are cheap to remount; a stale scroll position is not worth a shared
  // instance. The graph is the exception it earns by keying on page alone — its camera and expansion are
  // the workspace's home state, not one address's.
  const key = page === 'graph' ? 'graph' : `${page}/${param ?? ''}`
  return (
    <div className={`viewhost ${className}`}>
      {/* the boundary wraps the whole host, Suspense included, so a lazy chunk that will not load is
          contained the same way a render that throws is. The same key resets it: leaving a broken
          document is the reader's own recovery, and it must not need a reload. */}
      <ViewErrorBoundary resetKey={key}>
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
          <View key={key} param={param} query={query} />
        </Suspense>
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
  if (!split) return <ViewHost page={page} param={param} query={query} />
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
        ['shell.pageGraph', 'graph'], ['shell.pageSessions', 'sessions'], ['shell.pageEvals', 'evals'],
        ['shell.pageIssues', 'issues'], ['shell.pageSettings', 'settings'],
      ]
      const target = pageOf.find(([id]) => firesEvent(id, event))?.[1]
      if (target) {
        event.preventDefault(); closePalette()
        if (!graphOnly || target === 'graph') navigate(target)
        return true
      }
      if (!graphOnly && firesEvent('shell.newSession', event)) { event.preventDefault(); navigate('sessions', 'new'); return true }
      if (!graphOnly && firesEvent('shell.evals', event)) { event.preventDefault(); closePalette(); navigate('evals'); return true }
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
    if (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.settings', event.key)) {
      event.preventDefault(); navigate(page === 'settings' ? 'graph' : 'settings'); return true
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
        {/* only the BARE board face is full-bleed — #/evals/<node>/<scenario> and #/issues/<id> are
            object documents and keep the finding dock like any other document. */}
        {dock && !(BOARD_PAGES.has(page) && param == null) && (
          <ViewErrorBoundary resetKey="dock">
            <Dock mode={dockMode} specs={specs} sessions={sessions}
              focusId={page === 'spec' ? param : null} activeSessionId={page === 'sessions' ? param : null} />
          </ViewErrorBoundary>
        )}
        <div className="app-main">
          <div className="app-main-top"><TabStrip specs={specs} sessions={sessions} />
            {page === 'spec' && <ContextToggle visible={contextOpen} onToggle={toggleContext} />}
          </div>
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
