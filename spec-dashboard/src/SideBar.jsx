import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { PROJECT_ID, projectHref, hubHref } from './project.js'
import { PAGES } from './route.js'
import { IdentityIcon } from './IdentityIcon.jsx'

// The app's left navigation rail ([[side-nav]]) — the standard modern-app skeleton: one slim icon rail,
// always visible, one entry per top-level page (graph · sessions · evals · issues, settings pinned at the
// bottom). Clicking navigates the URL layer (route.js); the active page wears the accent. Glyphs come from
// the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria — the rail stays slim.
// Under the multi-project gateway ([[projects-hub]]) a scoped page adds the persistent current-project
// selector chip at the top. A successful catalog probe gives it same-tab switching plus the global
// /projects door; it never adds project management to the scoped rail. When the catalog is denied the
// chip still names the current project but carries no menu: the catalog stays unrevealed.

const ENTRIES = PAGES.filter((page) => page !== 'settings')

function RailButton({ page, active, onNav, label }) {
  return (
    <button
      type="button"
      className={active ? 'rail-btn on' : 'rail-btn'}
      data-tip={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNav(page)}
    >
      <Icon name={page} size={18} />
    </button>
  )
}

// the current-project chip + switcher menu. `projects` is the catalog list when the admin scope holds,
// else null (chip only). Navigation is a plain same-tab location change — the pathname carries the scope.
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
          {projects.map((p) => (
            <a
              key={p.id}
              role="menuitem"
              className={p.id === PROJECT_ID ? 'proj-menu-item current' : 'proj-menu-item'}
              href={projectHref(p.id)}
            >
              <IdentityIcon icon={p.identity.icon} size={16} className="proj-menu-mark" />
              {p.gated && <Icon name="lock" size={11} />}
              <span className="proj-menu-name">{p.identity.title}</span>
              {p.id === PROJECT_ID && <Icon name="check" size={12} />}
            </a>
          ))}
          <a role="menuitem" className="proj-menu-item all" href={hubHref()}>
            <IdentityIcon icon={gatewayIdentity?.icon} fallback="gateway" size={16} className="proj-menu-mark" />
            <span className="proj-menu-name">{t('nav.allProjects')}</span>
          </a>
        </div>
      )}
    </div>
  )
}

export default function SideBar({ page, onNav, identity, catalog }) {
  const t = useT()
  const catalogOk = catalog?.state === 'ok'
  return (
    <nav className="side-rail" aria-label={t('nav.railLabel')}>
      {PROJECT_ID && <ProjectChip
        identity={identity}
        projects={catalogOk ? catalog.projects : null}
        gatewayIdentity={catalogOk ? catalog.gateway.identity : null}
        t={t}
      />}
      {ENTRIES.map((p) => (
        <RailButton key={p} page={p} active={page === p} onNav={onNav} label={t(`nav.${p}`)} />
      ))}
      <div className="rail-spacer" />
      <RailButton page="settings" active={page === 'settings'} onNav={onNav} label={t('nav.settings')} />
    </nav>
  )
}
