import { useT } from './i18n/index.jsx'

// The app's left navigation rail ([[side-nav]]) — the standard modern-app skeleton: one slim icon rail,
// always visible, one entry per top-level page (graph · sessions · evals · issues, settings pinned at the
// bottom). Clicking navigates the URL layer (route.js); the active page wears the accent. Icons are the
// dashboard's monochrome inline-SVG vocabulary (currentColor stroke), labels live in tooltips/aria — the
// rail stays slim.

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
// Evals — the measured-loss feed: a bar-chart of scores with a check mark, the pass/fail readings.
const EvalsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 15.5 v-11" />
    <path d="M2.5 15.5 h13" />
    <rect x="4.6" y="10" width="2.6" height="3.5" rx="0.5" />
    <rect x="8.7" y="7" width="2.6" height="6.5" rx="0.5" />
    <path d="M13 6 l1.4 1.4 L16.5 3.6" />
  </svg>
)
const IssuesGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2.5 3.5 h13 v8.4 h-7 l-3.6 3 v-3 h-2.4 z" />
    <path d="M5.4 6.7 h7.2 M5.4 9.2 h4.8" />
  </svg>
)
const SettingsGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

const ENTRIES = [
  { page: 'graph', Glyph: GraphGlyph },
  { page: 'sessions', Glyph: SessionsGlyph },
  { page: 'evals', Glyph: EvalsGlyph },
  { page: 'issues', Glyph: IssuesGlyph },
]

function RailButton({ page, Glyph, active, onNav, label }) {
  return (
    <button
      type="button"
      className={active ? 'rail-btn on' : 'rail-btn'}
      data-tip={label}
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
