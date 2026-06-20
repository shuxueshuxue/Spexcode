---
title: graph-zoom
status: active
session: sess-00ef
hue: 200
desc: Zoom lives in scroll/pinch and the +/−/0 keys — no on-screen button panel clutters the canvas.
code:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/SessionGraph.jsx
---
# graph-zoom

Both graphs — the spec board ([[node-graph]] in `App.jsx`) and the session graph ([[session-graph]]) — are **scalable but un-chromed**. Zoom is always on, but it is a *gesture*, not a widget: there is **no on-screen control panel** (no `+`/`−`/fit buttons, no minimap) sitting over the canvas. The successor to the retired graph-minimap concern, this keeps the drawing surface clean — the tree is the only thing on screen.

Scaling stays fully available:

- **Scroll / pinch** zoom in and out on either graph, bounded by each graph's own `minZoom`/`maxZoom`.
- On the **board**, the `+`/`−` keys zoom and `0` returns to the overview zoom (the keyboard contract lives in [[keyboard-nav]]); the session graph also re-frames itself with `fitView` when its node set changes.

The rule is simply *what is absent*: a ReactFlow `<Controls>` (or `<MiniMap>`) overlay must not be mounted on either graph. Anything that needs to drive zoom does so through the gestures and keys above, never a re-introduced button panel.
