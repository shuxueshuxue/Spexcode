import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { Icon } from './icons.jsx'
import { PUBLIC_PAGES, RAIL_PAGES, navigate, routeHash } from './route.js'
import { focusLatestTab } from './tabs.js'
import { withShortcut } from './bindings.js'
import { useWorkspaceApi } from './workspace.jsx'
import { iconFor } from './viewCatalog.js'

// The workspace's rail ([[side-nav]]) — the top-level board bar. The dock's fold switch is not here: it rides
// the sidebar's own head row while open and the tab strip's first cell while closed (DockToggle). Board
// entries are navigation only: their plain click changes the route and never creates a strip tab.
// Glyphs come from the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria —
// the rail stays slim.
// Project identity and switching belong to the ambient status row ([[status-bar]]), so the route rail
// carries no second project control.

const ENTRIES = RAIL_PAGES

// The rail is only a destination link; review detail state stays in the route.
const railHref = (page) => routeHash(page)

// Which registry action reaches each rail entry. The rail is a READER of the keymap ([[keyboard-nav]]),
// so an entry names the binding by id and the hint is resolved at render — never typed into the label.
const PAGE_KEYS = {}

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

export default function SideBar({ page, graphOnly = false, needsYou = 0 }) {
  const t = useT()
  const { setDock, setDockMode } = useWorkspaceApi()
  const entries = ENTRIES
  return (
    // the rail is inert chrome for pointer focus ([[focus-return]]): a press navigates without taking DOM
    // focus, so chrome never becomes the focus-return ticket. Keyboard Tab still reaches every entry.
    <nav className="side-rail" aria-label={t('nav.railLabel')} onMouseDownCapture={inertChromePress}>
      {entries.map((p) => (
        <RailLink key={p} page={p} active={page === p || (p === 'spec' && page === 'file')}
          label={withShortcut(t(`nav.${p}`), ...(PAGE_KEYS[p] || []))}
          badge={p === 'sessions' ? needsYou : 0}
          disabled={graphOnly && !PUBLIC_PAGES.includes(p)}
          onNavigate={() => {
            // The sessions anchor unfolds the shared band and returns to the held session document; it
            // pre-selects NO dock projection. The route it lands on names its own ([[dock-modes]]), so a
            // projection written HERE had exactly one observable effect: the DEPARTING document's panel
            // flipped to the session forest for the frames before the route landed — the navigator
            // changing on a document that had not changed.
            if (p === 'sessions') {
              setDock?.(true)
              return focusLatestTab((tab) => tab.page === 'sessions' && tab.param)
            }
            if (p === 'spec') {
              setDock?.(true)
              setDockMode?.('explorer')
              return focusLatestTab((tab) => tab.page === 'spec')
            }
            if (p === 'graph') { setDock?.(true); setDockMode?.('explorer') }
            return false
          }} />
      ))}
      <div className="rail-spacer" />
    </nav>
  )
}
