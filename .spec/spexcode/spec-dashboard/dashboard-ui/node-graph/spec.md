---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots.
code:
  - spec-dashboard/src/SpecNode.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# node-graph

The full-forest view confused siblings with cousins. Show the local neighbourhood
and navigate by relationship.

## v2 — stable map
The tree sits at fixed absolute positions and never re-plots. The viewpoint moves
(a flat constant-zoom pan that centres the focus); only highlight / dim / edge
colour change per keystroke. Edges: bold = touches focus, faint = not.

## v3 — horizontal, single-line rows
Rotated the tree to left->right: depth sets the column (root at the left), siblings
stack as rows, parents centre over their kids vertically. Each node is now a thin
single line — status dot · title · version, no box, no thumbnail (screenshots live
in the evidence pane). Tight rows mean far more of the tree fits on one screen.
Keys rotate with it (see [[keyboard-nav]] v4).
