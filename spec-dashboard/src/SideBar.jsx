import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { Icon } from './icons.jsx'
import { PROJECT_ID, projectHref, hubHref } from './project.js'
import { RAIL_PAGES, routeHash } from './route.js'
import { focusLatestTab, pinTab } from './tabs.js'
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

const ENTRIES = RAIL_PAGES.filter((page) => !['sessions', 'settings'].includes(page))

// Which registry action reaches each rail entry. The rail is a READER of the keymap ([[keyboard-nav]]),
// so an entry names the binding by id and the hint is resolved at render — never typed into the label.
// Evals lists two because two keys genuinely open it; the dock projection buttons list none, because no
// action selects one projection by name and a hint that is only half true is worse than silence.
const PAGE_KEYS = {
  graph: ['shell.pageGraph'],
  sessions: ['shell.pageSessions'],
  evals: ['shell.pageEvals', 'shell.evals'],
  issues: ['shell.pageIssues'],
  settings: ['shell.pageSettings'],
}

// The finding controls render only inside a workspace: the cold review fast-path mounts this rail with no
// WorkspaceProvider above it, and projection buttons with no dock state would be a lie, not disabled chrome.
function WorkspaceControls() {
  const t = useT()
  const { dock, dockMode } = useWorkspace()
  const { setDock, setDockMode } = useWorkspaceApi()
  if (!setDock || !setDockMode) return null
  // Selecting a projection is a TEMPORARY override of the projection the focused tab implies
  // ([[dock-modes]]): it holds until the reader moves to another document, and then the dock goes back to
  // following. Clicking the active projection collapses the dock, which is the second door on the same
  // toggle as the dock's own collapse control.
  const selectMode = (mode) => {
    if (!dock) {
      setDock(true)
      setDockMode(mode)
    } else if (dockMode === mode) {
      setDock(false)
    } else {
      setDockMode(mode)
    }
    // ARMED, not opening: asking for a projection never mints a tab. The explorer waits for the reader to
    // pick a node; sessions returns to the session already held, and otherwise waits the same way — a
    // launch page nobody asked for is exactly the kind of document this workspace stopped putting on screen.
    if (mode === 'sessions') focusLatestTab((tab) => tab.page === 'sessions' && tab.param)
  }
  return (
    <>
      <button type="button" className={dock && dockMode === 'explorer' ? 'rail-btn on' : 'rail-btn'}
        data-tip={t('dockModes.explorer')} aria-label={t('dockModes.explorer')}
        aria-pressed={dock && dockMode === 'explorer'} onClick={() => selectMode('explorer')}>
        <Icon name="files" size={18} />
      </button>
      <button type="button" className={dock && dockMode === 'sessions' ? 'rail-btn on' : 'rail-btn'}
        data-tip={t('dockModes.sessions')} aria-label={t('dockModes.sessions')}
        aria-pressed={dock && dockMode === 'sessions'} onClick={() => selectMode('sessions')}>
        <Icon name="session-list" size={18} />
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
      // create-or-focus: a plain click holds the singleton rather than spending the current slot on it, so
      // clicking Evals twice is one tab and returning to it later finds it where it was left. Modified
      // clicks stay the browser's (new window, new browser tab, copy address).
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        pinTab(page)
      }}
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
        <RailLink key={p} page={p} active={page === p} label={withShortcut(t(`nav.${p}`), ...(PAGE_KEYS[p] || []))}
          disabled={graphOnly && p !== 'graph'} />
      ))}
      <div className="rail-spacer" />
      <RailLink page="settings" active={page === 'settings'} label={withShortcut(t('nav.settings'), ...PAGE_KEYS.settings)} disabled={graphOnly} />
    </nav>
  )
}
