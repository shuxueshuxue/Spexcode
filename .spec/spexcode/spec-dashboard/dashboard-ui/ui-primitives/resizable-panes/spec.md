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

**Every divider shows the same accent, including the ones on a chrome seam.** The finding dock and the
context dock each hide their grab strip on the edge of a panel rather than between two panes, and for a
while that difference cost them the affordance entirely: they were 6px of bare cursor change while the
split's own divider lit under the pointer. Two dividers with two answers to one question. They wear the
same accent now — nothing at rest, the accent on hover and for as long as a drag is live — so a seam that
can be moved says so wherever it is, and a resting window still gains no visible handle.

**The workspace's own splits are NOT on this hook, and that is the boundary.** This mechanism sizes a pane in
PIXELS against a persisted per-pane key — a sidebar, a panel, a dock. A [[workspace-shell]] split shares its
box between two subtrees as a RATIO carried in the workspace tree itself, on nodes that come and go as the
reader splits and collapses; there is no fixed pane and no fixed key to hang a width on, and a grid that
stored pixels would not survive a window resize. One mechanism per kind of seam, each owning its own state.

The session board's list ([[session-console]]) was the first pane on the mechanism. The session diff's
changed-file panel ([[diff-document]]) is on it too, so a reader with deep paths widens the panel instead of
reading clipped names. A future pane joins by mounting the same hook + divider, not by writing its own drag
handling; the graph remains a full-width canvas and therefore mounts no divider. There is no generic
`.pane-resizer` surface: each mounted consumer owns its named seam (`.content-divider`, `.ft-resize`,
`.ctx-resize`, or `.diff-panel-resize`), and the seams share one accent rule, so an unowned selector cannot
quietly become a second resize mechanism.
