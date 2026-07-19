import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { PROJECT_ID, projectHref, hubHref } from './project.js'

// The app's left navigation rail ([[side-nav]]) — the standard modern-app skeleton: one slim icon rail,
// always visible, one entry per top-level page (graph · sessions · evals · issues, settings pinned at the
// bottom). Clicking navigates the URL layer (route.js); the active page wears the accent. Glyphs come from
// the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria — the rail stays slim.
// Under the multi-project gateway ([[projects-hub]]) the rail grows two things, both catalog-gated: a
// PROJECTS entry (the catalog page — only when the catalog probe succeeded, so a direct-project guest
// never even sees the door) and, on a scoped page, the persistent current-project selector chip pinned at
// the very top — the project's initial, opening a menu of the catalog for same-tab switching. When the
// catalog is denied the chip still names the current project but carries no menu: the catalog stays
// unrevealed, the chip is orientation only.

const ENTRIES = ['graph', 'sessions', 'evals', 'issues']

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
function ProjectChip({ name, projects, t }) {
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
  const label = name || PROJECT_ID || ''
  const initial = (label || '?').trim().charAt(0).toUpperCase()
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
        {initial}
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
              {p.gated && <Icon name="lock" size={11} />}
              <span className="proj-menu-name">{p.name}</span>
              {p.id === PROJECT_ID && <Icon name="check" size={12} />}
            </a>
          ))}
          <a role="menuitem" className="proj-menu-item all" href={hubHref()}>
            <Icon name="projects" size={13} />
            <span className="proj-menu-name">{t('nav.allProjects')}</span>
          </a>
        </div>
      )}
    </div>
  )
}

export default function SideBar({ page, onNav, project, catalog }) {
  const t = useT()
  const catalogOk = catalog?.state === 'ok'
  return (
    <nav className="side-rail" aria-label={t('nav.railLabel')}>
      {PROJECT_ID && <ProjectChip name={project} projects={catalogOk ? catalog.projects : null} t={t} />}
      {ENTRIES.map((p) => (
        <RailButton key={p} page={p} active={page === p} onNav={onNav} label={t(`nav.${p}`)} />
      ))}
      {catalogOk && <RailButton page="projects" active={page === 'projects'} onNav={onNav} label={t('nav.projects')} />}
      <div className="rail-spacer" />
      <RailButton page="settings" active={page === 'settings'} onNav={onNav} label={t('nav.settings')} />
    </nav>
  )
}
