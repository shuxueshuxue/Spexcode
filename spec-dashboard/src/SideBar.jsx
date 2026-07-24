import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { Icon } from './icons.jsx'
import { PROJECT_ID, projectHref, hubHref } from './project.js'
import { PAGES, routeHash } from './route.js'
import { IdentityIcon } from './IdentityIcon.jsx'

// The app's left navigation rail ([[side-nav]]) — the standard modern-app skeleton: one slim icon rail,
// always visible, one entry per top-level page (graph · sessions · evals · issues, settings pinned at the
// bottom). Every entry is a REAL ANCHOR carrying its page's address, so a click is a native hash
// navigation — the same transaction the address bar, a bookmark, or ⌥digit produces — and
// middle-click/new-tab/copy-address come free; the active page wears the accent. Glyphs come from
// the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria — the rail stays slim.
// Under the multi-project gateway ([[projects-hub]]) a scoped page adds the persistent current-project
// selector chip at the top. A successful catalog probe gives it same-tab switching plus the global
// /projects door; it never adds project management to the scoped rail. When the catalog is denied the
// chip still names the current project but carries no menu: the catalog stays unrevealed.

const ENTRIES = PAGES.filter((page) => page !== 'settings')

function RailLink({ page, active, label }) {
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
function ProjectChip({ identity, projects, gatewayIdentity, t }) {
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
  return (
    <div className="proj-chip-wrap" ref={ref}>
      <button
        type="button"
        className={open ? 'rail-btn proj-chip on' : 'rail-btn proj-chip'}
        data-tip={t('nav.projectChip', { name: label })}
        aria-label={t('nav.projectChip', { name: label })}
        aria-haspopup={projects ? 'menu' : undefined}
        aria-expanded={projects ? open : undefined}
        onClick={() => { if (projects) setOpen((v) => !v) }}
      >
        <IdentityIcon icon={identity?.icon} size={26} />
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

export default function SideBar({ page, identity, catalog }) {
  const t = useT()
  const catalogOk = catalog?.state === 'ok'
  return (
    // the rail is inert chrome for pointer focus ([[focus-return]]): a press acts (link navigates, chip
    // menu opens) without taking DOM focus, so chrome never becomes the focus-return ticket and an
    // overlay close can never land focus here. Keyboard Tab still reaches every entry.
    <nav className="side-rail" aria-label={t('nav.railLabel')} onMouseDownCapture={inertChromePress}>
      {PROJECT_ID && <ProjectChip
        identity={identity}
        projects={catalogOk ? catalog.projects : null}
        gatewayIdentity={catalogOk ? catalog.gateway.identity : null}
        t={t}
      />}
      {ENTRIES.map((p) => (
        <RailLink key={p} page={p} active={page === p} label={t(`nav.${p}`)} />
      ))}
      <div className="rail-spacer" />
      <RailLink page="settings" active={page === 'settings'} label={t('nav.settings')} />
    </nav>
  )
}
