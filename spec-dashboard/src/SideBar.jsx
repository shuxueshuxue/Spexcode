import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { Icon } from './icons.jsx'
import { PROJECT_ID, projectHref, hubHref } from './project.js'
import { RAIL_PAGES, navigate, routeHash } from './route.js'
import { IdentityIcon } from './IdentityIcon.jsx'
import { withShortcut } from './bindings.js'
import { useWorkspace, useWorkspaceApi } from './workspace.jsx'

// The workspace's rail ([[side-nav]]) — an ACTIVITY BAR, not a page menu. Two kinds of entry, in this
// order: the dock's two PROJECTION buttons (explorer/sessions — they change what helps you look, and are
// buttons), then the SINGLETON BOARDS (evals · issues, settings pinned at the bottom). A board
// entry is create-or-focus: it opens its tab if the workspace does not hold one and focuses it if it does,
// which is what "singleton" means in the strip ([[tab-strip]]). It stays a real anchor carrying its
// address, so middle-click/new-tab/copy-address still come free and the plain click is intercepted only to
// hold the tab rather than to spend the current slot on it.
// Glyphs come from the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria —
// the rail stays slim.
// Under the multi-project gateway ([[projects-hub]]) a scoped page adds the persistent current-project
// selector chip at the top. A successful catalog probe gives it same-tab switching plus the global
// /projects door; it never adds project management to the scoped rail. When the catalog is denied the
// chip still names the current project and becomes the explicit /projects login door, without revealing
// the catalog.

const ENTRIES = RAIL_PAGES

// Which registry action reaches each rail entry. The rail is a READER of the keymap ([[keyboard-nav]]),
// so an entry names the binding by id and the hint is resolved at render — never typed into the label.
// Evals lists two because two keys genuinely open it. The dock panel switch has no page key: it is a
// state control, not a destination.
const PAGE_KEYS = {
  graph: ['shell.pageGraph'],
  sessions: ['shell.pageSessions'],
  evals: ['shell.pageEvals', 'shell.evals'],
  issues: ['shell.pageIssues'],
  settings: ['shell.pageSettings'],
}

// The dock's one rail control owns only open/closed state. Projection choice belongs to the route link
// that led there; it never gets the route's active styling and never navigates by itself.
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
      <Icon name={page} size={18} />
      {badge > 0 && <span className="rail-badge" aria-label={`${badge} needs you`}>{badge > 99 ? '99+' : badge}</span>}
    </span>
  )
  return (
    <a
      className={active ? 'rail-btn on' : 'rail-btn'}
      data-tip={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      href={routeHash(page)}
      // create-or-focus, and an ORDINARY navigation is already exactly that: a singleton board is resident
      // by address ([[view-registry]]), so the strip holds it whoever asked. The rail used to pin by hand,
      // which made residency a property of this button — and every other door into the same board (the
      // status tally, a pasted link) got the slot instead. Modified clicks stay the browser's (new window,
      // new browser tab, copy address).
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onNavigate?.()
        navigate(page)
      }}
    >
      <Icon name={page} size={18} />
      {badge > 0 && <span className="rail-badge" aria-label={`${badge} needs you`}>{badge > 99 ? '99+' : badge}</span>}
    </a>
  )
}

// the current-project chip + switcher menu. `projects` is the catalog list when the admin scope holds,
// else null (chip only). Online/unknown rows navigate with a plain same-tab location change; an explicitly
// offline row stays visible as a disabled status item because its scoped backend cannot serve the shell.
function ProjectChip({ identity, projects, gatewayIdentity, denied, t }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [open])
  const label = identity?.title || PROJECT_ID || ''
  const chipLabel = denied ? t('nav.projectChipLogin', { name: label }) : t('nav.projectChip', { name: label })
  if (denied) return (
    <div className="proj-chip-wrap" ref={ref}>
      <a
        className="rail-btn proj-chip"
        data-tip={chipLabel}
        aria-label={chipLabel}
        href={hubHref()}
      >
        <IdentityIcon icon={identity?.icon} size={27} />
      </a>
    </div>
  )
  return (
    <div className="proj-chip-wrap" ref={ref}>
      <button
        type="button"
        className={open ? 'rail-btn proj-chip proj-chip-open' : 'rail-btn proj-chip'}
        data-tip={chipLabel}
        aria-label={chipLabel}
        aria-haspopup={projects ? 'menu' : undefined}
        aria-expanded={projects ? open : undefined}
        onClick={() => { if (projects) setOpen((v) => !v) }}
      >
        <IdentityIcon icon={identity?.icon} size={27} />
      </button>
      {open && projects && (
        <div className="proj-menu" role="menu">
          {projects.map((p) => {
            const offline = p.online === false
            const current = p.id === PROJECT_ID
            const state = offline ? t('nav.projectOffline') : p.online === true ? t('nav.projectOnline') : null
            const className = `proj-menu-item${current ? ' current' : ''}${offline ? ' offline' : ''}`
            const content = (
              <>
                <IdentityIcon icon={p.identity.icon} size={16} className="proj-menu-mark" />
                {p.gated && <Icon name="lock" size={11} />}
                <span className="proj-menu-name">{p.identity.title}</span>
                {state && <span className={`proj-menu-status ${offline ? 'offline' : 'online'}`} aria-hidden="true">{state}</span>}
                {current && <Icon name="check" size={12} />}
              </>
            )
            return offline
              ? <div key={p.id} role="menuitem" aria-disabled="true" className={className}>{content}</div>
              : <a key={p.id} role="menuitem" className={className} href={projectHref(p.id)}>{content}</a>
          })}
          <a role="menuitem" className="proj-menu-item all" href={hubHref()}>
            <IdentityIcon icon={gatewayIdentity?.icon} fallback="gateway" size={16} className="proj-menu-mark" />
            <span className="proj-menu-name">{t('nav.allProjects')}</span>
          </a>
        </div>
      )}
    </div>
  )
}

export default function SideBar({ page, identity, catalog, graphOnly = false, needsYou = 0 }) {
  const t = useT()
  const { setDock, setDockMode } = useWorkspaceApi()
  const catalogOk = catalog?.state === 'ok'
  const catalogDenied = catalog?.state === 'denied'
  return (
    // the rail is inert chrome for pointer focus ([[focus-return]]): a press acts (link navigates, chip
    // menu opens) without taking DOM focus, so chrome never becomes the focus-return ticket and an
    // overlay close can never land focus here. Keyboard Tab still reaches every entry.
    <nav className="side-rail" aria-label={t('nav.railLabel')} onMouseDownCapture={inertChromePress}>
      {PROJECT_ID && <ProjectChip
        identity={identity}
        projects={catalogOk ? catalog.projects : null}
        gatewayIdentity={catalogOk ? catalog.gateway.identity : null}
        denied={catalogDenied}
        t={t}
      />}
      <DockToggle />
      {ENTRIES.map((p) => (
        <RailLink key={p} page={p} active={page === p}
          label={withShortcut(t(`nav.${p}`), ...(PAGE_KEYS[p] || []))}
          badge={p === 'sessions' ? needsYou : 0}
          disabled={graphOnly && p !== 'graph'}
          onNavigate={() => {
            if (p === 'sessions') { setDock?.(true); setDockMode?.('sessions') }
            else if (p === 'graph') { setDock?.(true); setDockMode?.('explorer') }
          }} />
      ))}
      <div className="rail-spacer" />
    </nav>
  )
}
