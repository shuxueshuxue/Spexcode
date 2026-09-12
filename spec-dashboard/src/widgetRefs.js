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
//
// @@@the-observer-lives-where-the-thing-it-watches-lives - the frame reports its own height rather than
// being measured from outside. Same-origin makes the outside version look free — `observe(frame
// .contentDocument.body)` from the host is one line and needs no cooperation — and it is not: an observer
// registered across a document boundary makes BOTH documents run their rendering lifecycle every vsync for
// as long as it is connected, and if it outlives the document it watches it goes on doing that forever.
// Measured on a live conversation with two widgets, two such observers left behind on documents no iframe
// owned any more: 60 style recalculations and 60 commits a second for a height that never changed, 7.4% of
// a core against 3.2% with them disconnected. Here the observer is created by the document it observes, so
// it cannot outlive it — a new body, a reload or an unmount destroys the document and the observer with it,
// and there is no host-side lifetime left to get wrong.
export function widgetDocument({ body, instance, theme, colorScheme }) {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<style>${theme}html{color-scheme:${colorScheme || 'light dark'}}`
    + `body{margin:0;padding:0;background:transparent;color:var(--fg);`
    + `font:var(--type-body,13px)/1.5 var(--ui-font-sans,system-ui);overflow:hidden}</style>`
    + `<script>window.spex=parent.__spexWidget(${JSON.stringify(instance)});`
    + `addEventListener('DOMContentLoaded',function(){`
    + `var report=function(){window.spex&&window.spex.resize(document.body.scrollHeight)};report();`
    + `if(window.ResizeObserver)new ResizeObserver(report).observe(document.body)})<\/script>`
    + `</head><body>${body}</body></html>`
}
