import { createContext } from 'react'

// `[[widget:<name>]]` — a component its session drew ([[widgets]]), named exactly. Unlike a posted file
// there is no path to shorten, so the reference IS the name and resolution is an equality check.
export const WIDGET_REF_RE = /\[\[widget:([a-z0-9][a-z0-9-]{0,63})\]\]/g

export const resolveWidgetRef = (name, widgets = []) => widgets.find((widget) => widget.name === name) || null

// The conversation supplies its session's widgets, the pending drafts, and the two writes a frame can make.
// A surface with no provider renders a widget reference as plain text, exactly as it renders a file
// reference it cannot resolve.
export const SessionWidgetsContext = createContext(null)

// The tokens a widget inherits from the dashboard. The `--bg`/`--fg`/`--accent` aliases are the names the
// skill teaches, so a widget written against them keeps working if the palette's own variable names move.
export const WIDGET_THEME_TOKENS = [
  '--paper', '--panel', '--ground', '--raised', '--line', '--ink', '--muted',
  '--blue', '--green', '--orange', '--red', '--yellow', '--magenta', '--cyan',
  '--ui-font-sans', '--mono', '--type-body', '--type-meta', '--radius',
]

export function widgetThemeStyle(root = document.documentElement) {
  const computed = getComputedStyle(root)
  const declarations = WIDGET_THEME_TOKENS
    .map((token) => [token, computed.getPropertyValue(token).trim()])
    .filter(([, value]) => value)
    .map(([token, value]) => `${token}:${value}`)
    .join(';')
  return `:root{${declarations};--bg:var(--paper);--fg:var(--ink);--accent:var(--blue)}`
}

// The host owns the document so that the theme, the state and the bridge exist before the widget's own
// script runs. An author who writes a whole document anyway still renders: the parser drops the nested
// html/head/body tags and keeps their content.
export function widgetDocument({ body, instance, theme, colorScheme }) {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<style>${theme}html{color-scheme:${colorScheme || 'light dark'}}`
    + `body{margin:0;padding:0;background:transparent;color:var(--fg);`
    + `font:var(--type-body,13px)/1.5 var(--ui-font-sans,system-ui);overflow:hidden}</style>`
    + `<script>window.spex=parent.__spexWidget(${JSON.stringify(instance)})<\/script>`
    + `</head><body>${body}</body></html>`
}
