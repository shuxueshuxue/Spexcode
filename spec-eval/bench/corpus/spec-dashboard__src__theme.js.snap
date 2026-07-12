// Whole-app light/dark theme. The palette lives in styles.css as :root (light) and
// :root[data-theme=dark]; this module just picks the theme and drives the `data-theme` attribute on
// <html>, mirroring the i18n localStorage pattern (i18n/index.jsx, key spexcode.lang). index.html
// applies the same choice inline before first paint so there's no light-flash on load.

const THEME_KEY = 'spexcode.theme'   // localStorage key holding the explicit user choice

export const THEMES = [
  { code: 'light', label: 'settings.theme.light' },
  { code: 'dark', label: 'settings.theme.dark' },
]

// the OS/browser preference → a supported theme.
export function systemTheme() {
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch { /* matchMedia may be unavailable — fall through to light */ }
  return 'light'
}

// the current effective theme: an explicit saved choice wins, else the system preference.
export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* localStorage may be unavailable (private mode) — fall through to detection */ }
  return systemTheme()
}

// set the theme live and remember it as the explicit override.
export function applyTheme(t) {
  const theme = (t === 'light' || t === 'dark') ? t : systemTheme()
  try { document.documentElement.setAttribute('data-theme', theme) } catch { /* no DOM (tests) */ }
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* persistence is best-effort */ }
  return theme
}
