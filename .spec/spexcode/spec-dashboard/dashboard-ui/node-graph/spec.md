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

Show the local neighbourhood and navigate by relationship — the full-forest view
confused siblings with cousins.

The tree sits at fixed absolute positions and never re-plots: the viewpoint moves (a
flat constant-zoom pan that centres the focus), and only highlight / dim / edge
colour change per keystroke. Layout is horizontal, left→right — depth sets the column
(root at the left), siblings stack as rows, and parents centre vertically over their
kids. Each node is a thin single line (status dot · title · version) — no box, no
thumbnail — so tight rows fit far more of the tree on one screen. Edges read bold when
they touch the focus, faint otherwise. Keys follow the same relationships (see
[[keyboard-nav]]).
