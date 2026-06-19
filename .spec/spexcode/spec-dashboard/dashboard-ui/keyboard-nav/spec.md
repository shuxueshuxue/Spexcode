---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/App.jsx
---
# keyboard-nav

## raw source

Move by relationship on a stable, depth-aligned tree — not by raw pixel distance. The tree never
re-plots; the camera moves. A Van Wijk zoom arc once made switching nodes "jump too high", so the
camera must flat-pan at constant zoom, never zoom-to-fit.

## expanded spec

`←` / `→` go to the parent / nearest child (the child closest in y). `↑` / `↓` move within the focused
node's **column** to the nearest node in that direction: depth pins x exactly (`x = depth · X_GAP`), so
a column is a clean vertical line and vertical nav never changes column or dives into a child. Columns
are aligned and rows aren't, so we navigate the organised axis — and it's reversible, since a column's
nodes are already ordered in y. `+` / `-` zoom, `0` resets to the overview zoom.

A keystroke only ever changes the *viewpoint* and the highlight / dim / edge state — the tree sits at
fixed absolute positions (see [[node-graph]]). `i` opens the node-info popup ([[work-pane]] /
[[ab-screenshots]]); `Enter` opens the session interface ([[session-console]]), focused on the focus
node's live session if it has one. While a modal (popup or session interface) is open it **owns** the
keys: arrows must not leak through to pan the board behind it — that was the old blind-navigation bug.

In `App.jsx` this is one capture-phase `keydown` listener that wins over react-flow. In graph mode `↑`/`↓`
call `nearestY('up'|'down')` (a same-x column scan for the nearest node in y), `←`→`parent`, `→`→the child
nearest in y; `=`/`+` and `-`/`_` zoom by 1.2×, `0` resets to the overview zoom; `i` opens the info popup;
`Enter` opens the focus node's live session. The camera is a plain rAF pan (`animateView` → `setViewport`,
cubic ease) that recentres the focus at constant zoom — no fit, no arc — so a switch flat-pans, never arcs.
When a modal is open the handler short-circuits: the session interface swallows all keys but `Escape`; the
info popup handles only `Escape` / `Tab` / `1`-`3` and explicitly drops the arrows. Click focuses a node
(and opens its live session if any); the key hints render in the HUD. `App.jsx` also hosts the graph render
(node positions, edges, and the faint dashed reparent-preview arrow for `moved` overlays — see
[[node-graph]]), but those are view concerns that never change the navigation contract above.
