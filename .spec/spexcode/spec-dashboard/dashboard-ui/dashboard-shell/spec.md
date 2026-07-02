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

dashboard-shell owns the three cross-cutting dashboard files: `App.jsx` (the desktop root — it mounts the
[[side-nav]] rail and swaps the routed page into the main area beside it, keeping the warm pages — the
graph, the session board — mounted across switches), `data.js` (the shared polled board data every view
reads), and `styles.css` (the global stylesheet). A feature node lists whichever of these it touches under
`related:`, so editing the shell or the stylesheet attributes its drift/yatsu here rather than to every
feature (see [[governed-related]]). This is the dashboard twin of [[sessions-core]]: one owner for the
substrate, references everywhere else.

**One palette, two themes.** The whole app — the spec-node board, the react-flow canvas, AND the
session console — draws its colours from one set of CSS custom properties (`--paper --panel --panel2
--line --ink --ink2 --muted`, the accents `--blue/--green/--red/--yellow/--orange/--magenta/--cyan`,
`--term-bg`). Because every rule reads through those vars, a
theme is nothing but a second definition of them: `styles.css` keeps the solarized-light set as bare
`:root`, and redefines the full set under `:root[data-theme=dark]` as a modern GitHub-Dark neutral
near-black palette — so flipping the one `data-theme` attribute on `<html>` re-skins board and console
together, with no per-component theme logic. The embedded terminal stays dark in both themes (the
Claude TUI is dark-designed), so `--term-bg` is a neutral near-black in light *and* dark. Even the
**scrollbars** read through the palette: `styles.css` themes them globally (a thin, rounded thumb —
`--line` at rest, `--muted` on hover, over a transparent track) via `::-webkit-scrollbar*` for Blink/WebKit
and `scrollbar-color`/`scrollbar-width` for Firefox, so every scrollable pane matches the app in both
themes with no per-surface rule and no raw-OS default. The terminal is styled only at its edge; xterm keeps
its viewport geometry so scrollback and TUI wheel paths stay truthful.

`theme.js` owns the pick: `getTheme()` returns an explicit saved choice (`localStorage
spexcode.theme`) else the system preference (`prefers-color-scheme`), and `applyTheme(t)` sets the
`data-theme` attribute and persists — the same detect-then-defer-to-the-human shape as [[settings]]'s
language pick. To avoid a light-flash before the module boots, `index.html` runs a tiny inline script
in `<head>` that applies the same choice to `<html data-theme>` before first paint. The [[settings]]
page carries the live toggle.

**Push-first board — freshest-issued wins.** The shell keeps the board fresh through three paths. The
primary is the **delta subscription** ([[board-stream]]/[[board-delta]]): whole boards arrive over the push
channel — a full on connect, then patches the data layer applies to its unit-map mirror — straight into
state, no refetch per change; a patch whose chain tag mismatches reopens the stream and re-anchors on the
fresh full. Second, an **on-demand** `reload()` (`/api/board`): a session close/rename calls it so every
surface reflects the change at once, and an old backend that only speaks bare `board-changed` downgrades the
subscription to exactly this refetch path. Third, a **slow fallback poll** that *stands down while push is
proven alive* (the server cold-ticks the un-watched paths for us then) and stands back up the moment the
stream errors or downgrades — so an untouched board fetches nothing, yet no environment (SSE-stripping
proxy, old backend) is ever staler than the poll period. Because pushed boards and in-flight fetches can
interleave, the shell stamps every application with a monotonic sequence — a pushed board is freshest by
channel order, so it bumps the sequence and invalidates any older fetch still in flight; a superseded
response is dropped, never painted. Without that guard a just-closed session resurrects: the post-close
reload paints the row gone, then a stale in-flight snapshot lands late and flickers it back. The guard makes
a removal stick the moment its own reload lands.
