import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { Icon } from './icons.jsx'
import { RAIL_PAGES, navigate, routeHash } from './route.js'
import { focusLatestTab } from './tabs.js'
import { withShortcut } from './bindings.js'
import { useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { iconFor } from './views.jsx'

// The workspace's rail ([[side-nav]]) — an ACTIVITY BAR, not a page menu. Two kinds of entry, in this
// order: the dock's two PROJECTION buttons (explorer/sessions — they change what helps you look, and are
// buttons), then the review/settings BOARD destinations pinned at the bottom. Board entries are navigation
// only: their plain click changes the route and never creates or focuses a strip tab.
// Glyphs come from the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria —
// the rail stays slim.
// Project identity and switching belong to the ambient status row ([[status-bar]]), so the route rail
// carries no second project control.

const ENTRIES = RAIL_PAGES

// Review routes have no workspace tab to remember them. Keep the last addressed review location as the
// rail's own navigation memory, so leaving a detail and pressing Evals/Issues returns to that detail instead
// of manufacturing a second tab or throwing the reader back to an unrelated board state.
const lastReviewAddress = new Map()
export const rememberReviewAddress = ({ page, param = null, query = null } = {}) => {
  if (page === 'evals' || page === 'issues') lastReviewAddress.set(page, { page, param, query })
}
const railHref = (page) => {
  const remembered = lastReviewAddress.get(page)
  return routeHash(page, remembered?.param ?? null, remembered?.query ?? null)
}

// Which registry action reaches each rail entry. The rail is a READER of the keymap ([[keyboard-nav]]),
// so an entry names the binding by id and the hint is resolved at render — never typed into the label.
// Evals lists two because two keys genuinely open it. The dock panel switch has no page key: it is a
// state control, not a destination.
const PAGE_KEYS = {
  sessions: ['shell.pageSessions'],
  evals: ['shell.pageEvals', 'shell.evals'],
  issues: ['shell.pageIssues'],
  settings: ['shell.pageSettings'],
}

// The dock's one rail control owns only open/closed state. Projection choice belongs to the route link
// that led there; it never gets the route's active styling and never navigates by itself. It is deliberately
// a smaller, muted control separated from the route group, so it reads as frame chrome rather than a sixth tab.
function DockToggle() {
  const t = useT()
  const { dock } = useWorkspace()
  const { setDock } = useWorkspaceApi()
  if (!setDock) return null
  const label = t(dock ? 'dockModes.collapse' : 'dockModes.expand')
  return (
    <button type="button" className="rail-btn rail-panel-toggle" data-tip={label} aria-label={label}
      aria-pressed={dock} onClick={() => setDock((value) => !value)}>
      <Icon name={dock ? 'panel-left' : 'panel-right'} size={18} />
    </button>
  )
}

function RailLink({ page, active, label, disabled = false, onNavigate, badge = 0 }) {
  if (disabled) return (
    <span className="rail-btn disabled" data-tip={label} aria-label={label} aria-disabled="true">
      <Icon name={iconFor(page) || page} size={18} />
      {badge > 0 && <span className="rail-badge" aria-label={`${badge} needs you`}>{badge > 99 ? '99+' : badge}</span>}
    </span>
  )
  return (
    <a
      className={active ? 'rail-btn on' : 'rail-btn'}
      data-tip={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      href={railHref(page)}
      // Boards are navigation destinations, not documents. Modified clicks stay the browser's (new window,
      // new browser tab, copy address).
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        // A projection request may focus an already-held document. That is still one route/tab grammar:
        // when it succeeds, the focused document owns the address and the rail light follows it. Only the
        // empty launch face needs the ordinary route navigation below.
        const handled = onNavigate?.() === true
        if (!handled) navigate(page)
      }}
    >
      <Icon name={iconFor(page) || page} size={18} />
      {badge > 0 && <span className="rail-badge" aria-label={`${badge} needs you`}>{badge > 99 ? '99+' : badge}</span>}
    </a>
  )
}

export default function SideBar({ page, graphOnly = false, needsYou = 0, hideDockToggle = false }) {
  const t = useT()
  const { setDock, setDockMode } = useWorkspaceApi()
  // The sealed public face is a graph product, not the live workspace. Keep its one graph marker while the
  // live rail intentionally omits graph as a top-level destination.
  const entries = graphOnly ? ['graph', ...ENTRIES] : ENTRIES
  return (
    // the rail is inert chrome for pointer focus ([[focus-return]]): a press navigates without taking DOM
    // focus, so chrome never becomes the focus-return ticket. Keyboard Tab still reaches every entry.
    <nav className="side-rail" aria-label={t('nav.railLabel')} onMouseDownCapture={inertChromePress}>
      {!hideDockToggle && <DockToggle />}
      {entries.map((p) => (
        <RailLink key={p} page={p} active={page === p}
          label={withShortcut(t(`nav.${p}`), ...(PAGE_KEYS[p] || []))}
          badge={p === 'sessions' ? needsYou : 0}
          disabled={graphOnly && p !== 'graph'}
          onNavigate={() => {
            if (p === 'sessions') {
              setDock?.(true)
              setDockMode?.('sessions')
              return focusLatestTab((tab) => tab.page === 'sessions' && tab.param)
            }
            if (p === 'graph') { setDock?.(true); setDockMode?.('explorer') }
            return false
          }} />
      ))}
      <div className="rail-spacer" />
    </nav>
  )
}
