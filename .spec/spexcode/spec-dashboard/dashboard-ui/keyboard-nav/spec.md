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

Left/right = siblings, up = parent, down = child. Logical keys on a stable tree.

## v2 — flat camera
Replaced React Flow's Van Wijk zoom arc (the "jump too high") with a flat
constant-zoom rAF pan that centres the focused node. +/- adjust the zoom.

## v3 — cross-subtree
Down descends to the horizontally nearest child. Left/right fall back to the
nearest node in that direction across the whole tree when no sibling exists —
reversible on a tidy tree because each subtree owns a contiguous x-band.

## v4 — axes follow the horizontal tree
The graph went left->right (root at left, children right), so the keys rotate to
match: up/down = siblings, left = parent, right = child. Same "move by
relationship" rule, now on the y-axis — siblings fall back to the nearest node
up/down across the tree (each subtree owns a contiguous y-band).
