import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { Icon } from './icons.jsx'
import { PROJECT_ID, projectHref, hubHref } from './project.js'
import { RAIL_PAGES, routeHash } from './route.js'
import { IdentityIcon } from './IdentityIcon.jsx'
import { useWorkspace, useWorkspaceApi } from './workspace.jsx'

// The workspace's rail ([[side-nav]]) — one slim icon strip with two kinds of entry, in this order:
// FINDING controls (explorer/sessions dock projections, search — they change what helps you look, and are
// buttons), then DOCUMENT OPENERS (graph · evals · issues, settings pinned at the bottom — they name an
// address, and are REAL ANCHORS carrying it, so a click is a native hash navigation — the same transaction
// the address bar, a bookmark, or ⌥digit produces — and middle-click/new-tab/copy-address come free; the
// active document kind wears the accent). Glyphs come from the shared icon vocabulary ([[icon-system]],
// icons.jsx); labels live in tooltips/aria — the rail stays slim.
// Under the multi-project gateway ([[projects-hub]]) a scoped page adds the persistent current-project
// selector chip at the top. A successful catalog probe gives it same-tab switching plus the global
// /projects door; it never adds project management to the scoped rail. When the catalog is denied the
// chip still names the current project and becomes the explicit /projects login door, without revealing
// the catalog.

const ENTRIES = RAIL_PAGES.filter((page) => !['sessions', 'settings'].includes(page))

// The finding controls render only inside a workspace: the cold review fast-path mounts this rail with no
// WorkspaceProvider above it, and projection buttons with no dock state would be a lie, not disabled chrome.
function WorkspaceControls() {
  const t = useT()
  const { dock, dockMode, palette } = useWorkspace()
  const { setDock, setDockMode, openPalette } = useWorkspaceApi()
  if (!setDock || !setDockMode) return null
  const selectMode = (mode) => {
    if (!dock) {
      setDock(true)
      setDockMode(mode)
    } else if (dockMode === mode) {
      setDock(false)
    } else {
      setDockMode(mode)
    }
  }
  return (
    <>
      <button type="button" className={dock && dockMode === 'explorer' ? 'rail-btn on' : 'rail-btn'}
        data-tip={t('dockModes.explorer')} aria-label={t('dockModes.explorer')}
        aria-pressed={dock && dockMode === 'explorer'} onClick={() => selectMode('explorer')}>
        <Icon name="explorer" size={18} />
      </button>
      <button type="button" className={dock && dockMode === 'sessions' ? 'rail-btn on' : 'rail-btn'}
        data-tip={t('dockModes.sessions')} aria-label={t('dockModes.sessions')}
        aria-pressed={dock && dockMode === 'sessions'} onClick={() => selectMode('sessions')}>
        <Icon name="session-list" size={18} />
      </button>
      <button type="button" className={palette ? 'rail-btn on' : 'rail-btn'} data-tip={t('nav.search')}
        aria-label={t('nav.search')} onClick={() => openPalette('nodes')}>
        <Icon name="search" size={18} />
      </button>
    </>
  )
}

function RailLink({ page, active, label, disabled = false }) {
  if (disabled) return (
    <span className="rail-btn disabled" data-tip={label} aria-label={label} aria-disabled="true">
      <Icon name={page} size={18} />
    </span>
  )
  return (
    <a
      className={active ? 'rail-btn on' : 'rail-btn'}
      data-tip={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      href={routeHash(page)}
    >
      <Icon name={page} size={18} />
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
        className={open ? 'rail-btn proj-chip on' : 'rail-btn proj-chip'}
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

export default function SideBar({ page, identity, catalog, graphOnly = false }) {
  const t = useT()
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
      <WorkspaceControls />
      {ENTRIES.map((p) => (
        <RailLink key={p} page={p} active={page === p} label={t(`nav.${p}`)} disabled={graphOnly && p !== 'graph'} />
      ))}
      <div className="rail-spacer" />
      <RailLink page="settings" active={page === 'settings'} label={t('nav.settings')} disabled={graphOnly} />
    </nav>
  )
}
