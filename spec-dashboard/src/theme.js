// Whole-app theme. The palettes live in styles.css — Minimal is the bare :root default, plus one
// :root[data-theme=<code>] row per other preset (design tokens ported from MIT-licensed Obsidian
// community themes; see spec-dashboard/THEME-CREDITS.md). This module just picks the theme and drives
// the `data-theme` attribute on <html>, mirroring the i18n localStorage pattern (i18n/index.jsx, key
// spexcode.lang). index.html applies the same choice inline before first paint so there's no
// wrong-palette flash on load — its inline code-list must stay in sync with THEMES here.

const THEME_KEY = 'spexcode.theme'   // localStorage key holding the explicit user choice

// One flat identifier per theme, all ported presets, Minimal first as the default. Labels are proper
// nouns and deliberately untranslated: t() passes an unknown key through verbatim, so Settings can
// feed every label to t() uniformly.
export const THEMES = [
  { code: 'minimal', label: 'Minimal' },
  { code: 'things', label: 'Things' },
  { code: 'tokyonight', label: 'Tokyo Night' },
  { code: 'catppuccin', label: 'Catppuccin' },
  { code: 'everforest', label: 'Everforest' },
  { code: 'gruvbox', label: 'Gruvbox' },
  { code: 'rosepine', label: 'Rosé Pine Dawn' },
  { code: 'dracula', label: 'Dracula' },
]
const CODES = new Set(THEMES.map((t) => t.code))
const DEFAULT = 'minimal'

// the current effective theme: a valid saved choice wins, anything else (absent, garbage, or the
// retired legacy light/dark codes) resolves to the Minimal default.
export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (CODES.has(saved)) return saved
  } catch { /* localStorage may be unavailable (private mode) — fall through to the default */ }
  return DEFAULT
}

// set the theme live and remember it as the explicit override.
export function applyTheme(t) {
  const theme = CODES.has(t) ? t : DEFAULT
  try { document.documentElement.setAttribute('data-theme', theme) } catch { /* no DOM (tests) */ }
  try { localStorage.setItem(THEME_KEY, theme) } catch { /* persistence is best-effort */ }
  return theme
}
