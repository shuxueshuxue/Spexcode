import { useT } from './i18n/index.jsx'

// The app's left navigation rail ([[side-nav]]) — the standard modern-app skeleton: one slim icon rail,
// always visible, one entry per top-level page (graph · sessions · forum, settings pinned at the bottom).
// Clicking navigates the URL layer (route.js); the active page wears the accent. Icons are the dashboard's
// monochrome inline-SVG vocabulary (currentColor stroke), labels live in tooltips/aria — the rail stays slim.

const GraphGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.5" y="6.5" width="5" height="4.4" rx="1" />
    <rect x="11.5" y="1.8" width="5" height="4.4" rx="1" />
    <rect x="11.5" y="11.8" width="5" height="4.4" rx="1" />
    <path d="M6.5 8.7 h2.2 M11.5 4 h-1.3 q-1.5 0-1.5 1.5 v7 q0 1.5 1.5 1.5 h1.3" />
  </svg>
)
const SessionsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="1.5" y="2.5" width="15" height="13" rx="1.6" />
    <path d="M4.6 6.5 l2.6 2.3 -2.6 2.3 M9 12.4 h4" />
  </svg>
)
const ForumGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 3.5 h13 v8.4 h-7 l-3.6 3 v-3 h-2.4 z" />
    <path d="M5.4 6.7 h7.2 M5.4 9.2 h4.8" />
  </svg>
)
const SettingsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 1.8 v2.1 M9 14.1 v2.1 M1.8 9 h2.1 M14.1 9 h2.1 M3.9 3.9 l1.5 1.5 M12.6 12.6 l1.5 1.5 M14.1 3.9 l-1.5 1.5 M5.4 12.6 l-1.5 1.5" />
  </svg>
)

const ENTRIES = [
  { page: 'graph', Glyph: GraphGlyph },
  { page: 'sessions', Glyph: SessionsGlyph },
  { page: 'forum', Glyph: ForumGlyph },
]

function RailButton({ page, Glyph, active, onNav, label }) {
  return (
    <button
      type="button"
      className={active ? 'rail-btn on' : 'rail-btn'}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNav(page)}
    >
      <Glyph />
    </button>
  )
}

export default function SideBar({ page, onNav }) {
  const t = useT()
  return (
    <nav className="side-rail" aria-label={t('nav.railLabel')}>
      {ENTRIES.map((e) => (
        <RailButton key={e.page} page={e.page} Glyph={e.Glyph} active={page === e.page} onNav={onNav} label={t(`nav.${e.page}`)} />
      ))}
      <div className="rail-spacer" />
      <RailButton page="settings" Glyph={SettingsGlyph} active={page === 'settings'} onNav={onNav} label={t('nav.settings')} />
    </nav>
  )
}
