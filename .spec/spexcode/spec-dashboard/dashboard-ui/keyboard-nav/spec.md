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

## current state

### description

`App.jsx` installs one capture-phase `keydown` listener so it wins over react-flow. Graph mode: `↑`/`↓`
call `nearestY('up'|'down')` (a same-x column scan for the nearest node in y), `←`→`parent`,
`→`→`childTarget` (the child nearest in y); `=`/`+` and `-`/`_` zoom by 1.2× via `centerOn`, `0` resets
to 0.85; `i` opens the info popup; `Enter` calls `openSession(liveSessionFor(focus)?.id)`. The camera is
a plain rAF pan (`animateView` → `setViewport`, cubic ease) that recentres the focus at constant zoom —
no fit, no arc. When a modal is open the handler short-circuits: the session interface swallows all keys
but `Escape`; the info popup handles only `Escape` / `Tab` / `1`-`3` and explicitly drops arrows. Click
focuses a node (and opens its live session if any); the key hints render in the HUD.

### verdict — not drifted

`App.jsx` is the only governed file and, after this rewrite, sits at the node's latest version with no
commits ahead (`spex lint` reports no `drift` warning for `keyboard-nav`). The expanded spec states the
navigation contract as intended behavior; the description is the honest read of how `App.jsx` meets it
today. The `Enter` / `i` / modal-owns-keys handling grew as the session interface and node popup landed —
the expanded spec now names them and the description records them, rather than back-writing code into the
spec. The raw source (relationship nav on a fixed tree, flat-pan camera) still holds.
