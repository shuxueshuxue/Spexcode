---
title: dashboard-shell
status: active
hue: 200
desc: The desktop dashboard's root shell + shared substrate — the App.jsx root/router, the data.js polled-board layer, and the global styles.css — that every dashboard feature renders within.
code:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/theme.js
---
# dashboard-shell

## raw source

The dashboard's feature nodes (node-graph, focus-panel, keyboard-nav, the session views…) all mount inside
one root component, poll through one data layer, and style against one global stylesheet. That substrate
has no single feature owner, so co-owning it fanned every shell/style edit across all of them. Give it a
foundation node; features REFERENCE what they touch via `related:` instead of co-owning it.

## expanded spec

dashboard-shell owns the three cross-cutting dashboard files: `App.jsx` (the desktop root — layout and the
routing between the graph and the session views), `data.js` (the shared polled board data every view
reads), and `styles.css` (the global stylesheet). A feature node lists whichever of these it touches under
`related:`, so editing the shell or the stylesheet attributes its drift/yatsu here rather than to every
feature (see [[governed-related]]). This is the dashboard twin of [[sessions-core]]: one owner for the
substrate, references everywhere else.

**One palette, two themes.** The whole app — the spec-node board, the react-flow canvas, AND the
session console — draws its colours from one set of CSS custom properties (`--paper --panel --panel2
--line --ink --ink2 --muted`, the accents `--blue/--green/--red/--yellow/--orange/--magenta/--cyan`,
`--term-bg`, the `--sg-comms*` session-graph tokens). Because every rule reads through those vars, a
theme is nothing but a second definition of them: `styles.css` keeps the solarized-light set as bare
`:root`, and redefines the full set under `:root[data-theme=dark]` as a modern GitHub-Dark neutral
near-black palette — so flipping the one `data-theme` attribute on `<html>` re-skins board and console
together, with no per-component theme logic. The embedded terminal stays dark in both themes (the
Claude TUI is dark-designed), so `--term-bg` is a neutral near-black in light *and* dark.

`theme.js` owns the pick: `getTheme()` returns an explicit saved choice (`localStorage
spexcode.theme`) else the system preference (`prefers-color-scheme`), and `applyTheme(t)` sets the
`data-theme` attribute and persists — the same detect-then-defer-to-the-human shape as [[settings]]'s
language pick. To avoid a light-flash before the module boots, `index.html` runs a tiny inline script
in `<head>` that applies the same choice to `<html data-theme>` before first paint. The [[settings]]
popup carries the live toggle.

**Polled board — freshest-issued wins.** The shell re-fetches `/api/board` every 4s AND on demand (a
session close/rename calls `reload()` so every surface reflects the change at once), so several `loadBoard()`
requests can be in flight together. Because they resolve out of order and an older request carries an older
backend snapshot, the shell stamps each call with a monotonic sequence and applies only the latest-issued
response — a superseded one is dropped, never painted. Without that guard a just-closed session resurrects:
the post-close reload paints the row gone, then a poll that was already in flight (snapshotted *before* the
worktree removal) lands late and flickers it back until the next poll. The guard makes a removal stick the
moment its own reload lands.
