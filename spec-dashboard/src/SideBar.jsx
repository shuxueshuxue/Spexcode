import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The app's left navigation rail ([[side-nav]]) — the standard modern-app skeleton: one slim icon rail,
// always visible, one entry per top-level page (graph · sessions · evals · issues, settings pinned at the
// bottom). Clicking navigates the URL layer (route.js); the active page wears the accent. Glyphs come from
// the shared icon vocabulary ([[icon-system]], icons.jsx); labels live in tooltips/aria — the rail stays slim.

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

export default function SideBar({ page, onNav }) {
  const t = useT()
  return (
    <nav className="side-rail" aria-label={t('nav.railLabel')}>
      {ENTRIES.map((p) => (
        <RailButton key={p} page={p} active={page === p} onNav={onNav} label={t(`nav.${p}`)} />
      ))}
      <div className="rail-spacer" />
      <RailButton page="settings" active={page === 'settings'} onNav={onNav} label={t('nav.settings')} />
    </nav>
  )
}
