---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots.
---
# node-graph

The full-forest view confused siblings with cousins. Show the local neighbourhood
and navigate by relationship.

## v2 — stable map
The tree sits at fixed absolute positions and never re-plots. The viewpoint moves
(a flat constant-zoom pan that centres the focus); only highlight / dim / edge
colour change per keystroke. Edges: bold = touches focus, faint = not.
