---
title: resizable-panes
status: active
hue: 210
desc: Fixed-width side panes are user-resizable — drag the pane border (session list, graph focus panel), width clamps and persists per pane.
code:
  - spec-dashboard/src/useResizable.js
---

# resizable-panes

## raw source

The dashboard's side panes shipped at hardcoded widths — the session board's list at 240px, the graph's
focus panel at 250px — a terminal-era rigidity. A modern app lets the user drag a pane border to fit
their content (long session titles, a wide monitor) and remembers the choice.

## expanded spec

One mechanism for every resizable pane, not per-pane drag code: a pane border carries a thin
**col-resize divider** (invisible at rest; a subtle accent line appears on hover/drag, so the affordance
shows exactly when reached for). Dragging it resizes the pane live; the width **clamps** to a per-pane
min/max so no pane can crush its neighbor or vanish; release **persists** the width per pane
(localStorage), so it survives reloads and is per-browser like the theme and language picks. While a
drag is live, text selection is suspended and the resize cursor holds app-wide, so a fast drag never
smears a selection across the page.

Current panes on the mechanism: the session board's list ([[session-console]]) and the graph page's
focus panel ([[focus-panel]]). A future pane joins by mounting the same hook + divider, not by writing
its own drag handling.
