---
title: graph-minimap
status: active
session: 1cdc499b
hue: 280
desc: Both ReactFlow graphs carry a bottom-left navigator MiniMap in place of the +/−/fit Controls; scroll/pinch zoom stays.
code:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/SessionGraph.jsx
  - spec-dashboard/src/styles.css
---

# graph-minimap

Both ReactFlow graphs — the spec board ([[node-graph]] · `App.jsx`) and the session graph
([[session-graph]] · `SessionGraph.jsx`) — render an `@xyflow` **MiniMap pinned bottom-left**, taking
the spot the `+`/`−`/fit **Controls** cluster used to hold. The button cluster is gone; **scroll / pinch
zoom stays on** (ReactFlow's default), and the map itself is **pannable and zoomable** — drag it to pan,
scroll over it to zoom — so navigation loses nothing by dropping the buttons.

The map is a live thumbnail, not decoration: each node rect is **tinted to mean something**. On the board
that is the node's **live four-state status** colour (the same green/orange/yellow/grey the dots use); on
the session graph it is the session's **lineage hue** (`labelColor(id)`, the one colour system every mark
keying off a session id shares — see [[node-graph]]). The map sits on a visible panel — `var(--panel)`
fill, `var(--line)` hairline border (`.react-flow__minimap`) — so the tinted rects read against the
dotted background.

**Drawing invariant.** A MiniMap can only draw a node it has dimensions for. `@xyflow` v12 measures node
boxes from the DOM *after* first paint, so a node object carrying only a `position` leaves the map blank on
the initial render. Therefore every node object **declares an explicit `width`/`height`** matching its
rendered box — spec nodes `220×46` (`.spec-node`), session nodes `112×60` (`.sg-node`) — giving the map
real rects to paint before measurement catches up.

Visual confirmation is **pending**: there is no browser/e2e harness yet (it arrives with `spec-yatsu`), so
this contract is verified by type-check + lint and by reading the @xyflow draw path, not yet by a rendered
screenshot.
