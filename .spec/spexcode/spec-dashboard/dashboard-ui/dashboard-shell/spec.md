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
Claude TUI is dark-designed), so `--term-bg` is a neutral near-black in light *and* dark. Even the
**scrollbars** read through the palette: `styles.css` themes them globally (a thin, rounded thumb —
`--line` at rest, `--muted` on hover, over a transparent track) via `::-webkit-scrollbar*` for Blink/WebKit
and `scrollbar-color`/`scrollbar-width` for Firefox, so every scrollable pane matches the app in both
themes with no per-surface rule and no raw-OS default breaking the skin.

`theme.js` owns the pick: `getTheme()` returns an explicit saved choice (`localStorage
spexcode.theme`) else the system preference (`prefers-color-scheme`), and `applyTheme(t)` sets the
`data-theme` attribute and persists — the same detect-then-defer-to-the-human shape as [[settings]]'s
language pick. To avoid a light-flash before the module boots, `index.html` runs a tiny inline script
in `<head>` that applies the same choice to `<html data-theme>` before first paint. The [[settings]]
popup carries the live toggle.

**Push-first board — freshest-issued wins.** The shell keeps the board fresh through three paths that all
funnel into one `reload()` (`/api/board`): a **push** subscription ([[board-stream]]) that reloads the instant
the backend signals a session-store change, so status and grouping flip without waiting on a timer; an
**on-demand** reload (a session close/rename calls it so every surface reflects the change at once); and a
**slow fallback poll** that catches the cold path the push channel doesn't watch (a spec edit/merge, a forge
issue) and covers an environment where SSE never connects. The tight 4s poll is gone — an untouched board now
fetches nothing instead of a full snapshot every few seconds. Because several `loadBoard()` requests can be in
flight together and resolve out of order (an older one carrying an older backend snapshot), the shell stamps
each call with a monotonic sequence and applies only the latest-issued response — a superseded one is dropped,
never painted. Without that guard a just-closed session resurrects: the post-close reload paints the row gone,
then a reload already in flight (snapshotted *before* the worktree removal) lands late and flickers it back.
The guard makes a removal stick the moment its own reload lands.
