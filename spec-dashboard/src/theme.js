// Whole-app theme. The palettes live in styles.css — Minimal is the bare :root default, plus one
// :root[data-theme=<code>] row per other preset (design tokens ported from MIT-licensed Obsidian
// community themes; see spec-dashboard/THEME-CREDITS.md). This module just picks the theme and drives
// the `data-theme` attribute on <html>, mirroring the i18n localStorage pattern (i18n/index.jsx, key
// spexcode.lang). index.html applies the same choice inline before first paint so there's no
// wrong-palette flash on load — its inline code-list must stay in sync with THEMES here.

const THEME_KEY = 'spexcode.theme'   // localStorage key holding the explicit user choice

// One flat identifier per theme, all ported presets, Minimal first as the default. Labels are proper
// nouns and deliberately untranslated: t() passes an unknown key through verbatim, so Settings can
// feed every label to t() uniformly. The swatch is the preset's own ground, paper, ink, and accent —
// the four values the picker paints so a reader sees a theme before choosing it; the styles gate holds
// each swatch to the theme row in styles.css, so the picker can never show a palette the sheet no longer has.
export const THEMES = [
  { code: 'minimal', label: 'Minimal', swatch: { ground: '#1b1b1b', paper: '#262626', ink: '#d1d1d1', accent: '#6c99bb' } },
  { code: 'notion', label: 'Notion', swatch: { ground: '#f7f7f5', paper: '#ffffff', ink: '#37352f', accent: '#2383e2' } },
  { code: 'things', label: 'Things', swatch: { ground: '#eceef0', paper: '#ffffff', ink: '#555e68', accent: '#2e80f2' } },
  { code: 'tokyonight', label: 'Tokyo Night', swatch: { ground: '#101018', paper: '#1a1b26', ink: '#a9b1d6', accent: '#7aa2f7' } },
  { code: 'catppuccin', label: 'Catppuccin', swatch: { ground: '#11111b', paper: '#1e1e2e', ink: '#cdd6f4', accent: '#89b4fa' } },
  { code: 'everforest', label: 'Everforest', swatch: { ground: '#232a2e', paper: '#333c43', ink: '#d3c6aa', accent: '#7fbbb3' } },
  { code: 'gruvbox', label: 'Gruvbox', swatch: { ground: '#151718', paper: '#282828', ink: '#ebdbb2', accent: '#83a598' } },
  { code: 'rosepine', label: 'Rosé Pine Dawn', swatch: { ground: '#eee4d9', paper: '#faf4ed', ink: '#575279', accent: '#56949f' } },
  { code: 'dracula', label: 'Dracula', swatch: { ground: '#191a21', paper: '#282a36', ink: '#f8f8f2', accent: '#bd93f9' } },
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
