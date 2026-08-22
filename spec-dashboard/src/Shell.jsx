import { Suspense } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import StatusBar, { useStatusItem } from './StatusBar.jsx'
import TabStrip from './TabStrip.jsx'
import FileTree from './FileTree.jsx'
import SpecSearch from './SpecSearch.jsx'
import { useRoute, navigate } from './route.js'
import { useT } from './i18n/index.jsx'
import { useBoard, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { viewFor } from './views.jsx'
import { useResizable } from './useResizable.js'
import { Icon } from './icons.jsx'

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

function ViewHost({ page, param, query }) {
  const t = useT()
  const { component: View, className } = viewFor(page)
  return (
    <div className={`viewhost ${className}`}>
      <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
        {/* keyed on the address: a different document is a different instance, so one document's state can
            never bleed into the next. Views are cheap to remount; a stale scroll position is not worth a
            shared instance. The graph is the exception it earns by keying on page alone — its camera and
            expansion are the workspace's home state, not one address's. */}
        <View key={page === 'graph' ? 'graph' : `${page}/${param ?? ''}`} param={param} query={query} />
      </Suspense>
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

export default function Shell() {
  const t = useT()
  const { page, param, query } = useRoute()
  const { specs, sessions, identity, catalog, graphOnly } = useBoard()
  const { dock, palette } = useWorkspace()
  const { closePalette } = useWorkspaceApi()

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
        {dock && <FileTree specs={specs} focusId={page === 'spec' ? param : null} />}
        <div className="app-main">
          <TabStrip specs={specs} sessions={sessions} />
          <Content page={page} param={param} query={query} />
        </div>
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
