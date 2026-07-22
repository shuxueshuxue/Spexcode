---
title: resizable-panes
status: active
hue: 210
desc: The session console's fixed-width list is user-resizable — drag its border, clamp the width, and persist the choice through one reusable pane mechanism.
code:
  - spec-dashboard/src/useResizable.js#useResizable
---

# resizable-panes

## raw source

The session board's list shipped at a hardcoded 240px — a terminal-era rigidity. A modern app lets the user
drag the pane border to fit long session titles or a wide monitor and remembers the choice.

## expanded spec

One mechanism for every resizable pane, not per-pane drag code: a pane border carries a thin
**col-resize divider** (invisible at rest; a subtle accent line appears on hover/drag, so the affordance
shows exactly when reached for). Dragging it resizes the pane live; the width **clamps** to a per-pane
min/max so no pane can crush its neighbor or vanish; release **persists** the width per pane
(localStorage), so it survives reloads and is per-browser like the theme and language picks. While a
drag is live, text selection is suspended and the resize cursor holds app-wide, so a fast drag never
smears a selection across the page.

The divider also follows the familiar editor-panel reset gesture: a double-click clears that pane's stored
override and restores its current product default. Reset is returned by the same hook, so consumers do not
reach into localStorage or duplicate default-width knowledge.

The current pane on the mechanism is the session board's list ([[session-console]]). A future pane joins by
mounting the same hook + divider, not by writing its own drag handling; the graph remains a full-width canvas
and therefore mounts no divider.
