// Whole-app theme. The palettes live in styles.css — :root (light), :root[data-theme=dark], and one
// :root[data-theme=<code>] row per community preset (design tokens ported from MIT-licensed Obsidian
// community themes; see spec-dashboard/THEME-CREDITS.md). This module just picks the theme and drives
// the `data-theme` attribute on <html>, mirroring the i18n localStorage pattern (i18n/index.jsx, key
// spexcode.lang). index.html applies the same choice inline before first paint so there's no
// light-flash on load — its inline code-list must stay in sync with THEMES here.

const THEME_KEY = 'spexcode.theme'   // localStorage key holding the explicit user choice

// One flat identifier per theme — the base pair plus the ported presets. Preset labels are proper
// nouns and deliberately untranslated: t() passes an unknown key through verbatim, so Settings can
// feed every label to t() uniformly.
export const THEMES = [
  { code: 'light', label: 'settings.theme.light' },
  { code: 'dark', label: 'settings.theme.dark' },
  { code: 'minimal', label: 'Minimal' },
  { code: 'things', label: 'Things' },
  { code: 'tokyonight', label: 'Tokyo Night' },
  { code: 'catppuccin', label: 'Catppuccin' },
]
const CODES = new Set(THEMES.map((t) => t.code))

// the OS/browser preference → a base theme. The system axis only knows light/dark; a community
// preset is always an explicit choice, never a detection result.
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
    if (CODES.has(saved)) return saved
  } catch { /* localStorage may be unavailable (private mode) — fall through to detection */ }
  return systemTheme()
}

// set the theme live and remember it as the explicit override.
export function applyTheme(t) {
  const theme = CODES.has(t) ? t : systemTheme()
  try { document.documentElement.setAttribute('data-theme', theme) } catch { /* no DOM (tests) */ }
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* persistence is best-effort */ }
  return theme
}
