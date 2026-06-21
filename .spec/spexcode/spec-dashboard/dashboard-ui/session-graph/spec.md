---
title: session-graph
status: active
hue: 280
desc: Experimental — sessions as a directed monitor network; t opens it, arrows = live `spex watch` edges.
code:
  - spec-dashboard/src/SessionGraph.jsx
---

# session-graph

## raw source

Sessions are not only spec-editors — they **watch each other**. Show them as a **directed monitor
network**: each session a node, each *live monitor* (agent A running `spex watch B`) a directed arrow
A→B. The view is **experimental and isolated** — it must drop in without disturbing the spec board or any
existing view. `t` (or a small floating button on the board, with `t` documented in the help) opens it; Esc
returns. The arrows are **observational** — they reflect who is watching whom right now and appear/disappear
as watches start and stop. The one human gesture is **asking**: dragging A→B does not draw a stored edge, it
**asks agent A to monitor B**. Clicking a node **opens that session's console**.

## expanded spec

`t` (an otherwise-unbound board key, so it shadows no nav) opens a full-screen session-graph over the
board; Esc returns. Because a hidden hotkey is undiscoverable, the board carries a **small floating
button** that opens the same view — and the session-graph carries the **mirror** of it (same affordance,
a tree glyph for the spec graph) that toggles **back**, so the one `t` crossing is discoverable from
**both** sides, not just on the way in. `t` is **listed in the help/legend** alongside the other board keys.
The same discipline governs the view's **own** keys: rather than an always-on inline hint, the graph carries
the **same discreet `?` help affordance the board uses** (key or button), opening a small legend of its
keymap (move · open · drag-to-monitor · `t` back) and its edge vocabulary — one consistent help surface
across both graphs, not a standing wall of text.
Isolation is the governing principle: the view runs in its **own** ReactFlow context (separate camera,
selection, store) and reads its **own** data (`GET /api/sessions/graph`, see [[sessions]]) — it shares no
state with the board, so it cannot break it. While it is open it **owns all keys** (the board's keydown
shell yields to it), and on close the board is exactly as it was.

It must open **already framed**: the overlay waits for the first graph to arrive and then mounts with a
viewport pre-computed from the node bounds, so the first paint is centred on the web — never an empty screen
that pans into place a beat later.

Each node is a session, rendered with the **same** seed-to-hue colour and generated avatar the rest of
the dashboard keys off its session id ([[node-graph]] · `color.js` / `avatar.jsx`), so a face here is the
same face that session shows everywhere. Layout is a **network**, not a tree — sessions sit on a radial
ring so the directed edges read as a web of relationships, not a hierarchy. Each edge is a **live
monitor** drawn in the **watcher's** hue. **Clicking a node opens that session's console** by reusing the
board's existing open-session path — no new mechanism, just an entry point from the graph.

The **live** edges are derived from live watches, not user-drawn (see [[sessions]]): the view **does not
create or remove** them — it **polls** the endpoint, so a watch starting or stopping makes its arrow appear
or vanish on its own; a global (`--all`) watcher shows as arrows to every node. Closing a session removes it
as a node and its arrows vanish with it, because the backend only derives edges between live sessions — the
graph never shows a dangling arrow.

Asking is the exception, and it stays faithful to the no-store rule. Dragging A→B **dispatches a prompt to
agent A** (over the same `/keys` channel the session console uses) telling it to monitor B with its monitor
tool (`spex watch B`); **no subscription is written**. The gesture must never fail for a reason the user
can't see: on a radial ring two nodes face arbitrary directions, so a drag may start or land on **any**
anchor of either node — every anchor is connectable to every other, and the only thing that carries meaning
is the drag's **direction**: the node the drag **started on is the watcher**, the other end the watched,
regardless of which anchors the line happened to touch. The dispatch alone isn't enough — the gesture must
*feel* acknowledged immediately: the moment the drag completes, an **optimistic pending edge** (dashed, in
A's hue) appears and a brief **toast** confirms "asked A to monitor B", so the user never repeats the
gesture or wonders whether it took. That edge is provisional; it **firms up to a solid live arrow** only
once A's real `spex watch` registration arrives on the next poll (and a pending edge is superseded by its
live twin, never doubled). Nodes remain draggable to arrange the layout.
