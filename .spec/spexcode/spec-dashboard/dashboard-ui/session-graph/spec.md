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
existing view. `t` (or a small floating button on the board, with `t` documented in the help) opens it, and
the same `t` returns. The arrows are **observational** — they reflect who is watching whom right now and
appear/disappear as watches start and stop. The one human gesture is **asking**: dragging A→B does not draw
a stored edge, it **asks agent A to monitor B**. Clicking a node **opens that session's console**.

## expanded spec

`t` (an otherwise-unbound board key, owned by App) is the **only** switch in or out, and it toggles **both**
ways from one place. Because a hidden hotkey is undiscoverable, the board carries a small floating button
that opens the view, the graph carries its mirror (a tree glyph) that toggles back, and `t` is **listed in
the help/legend** — so the one crossing is discoverable from both sides. The view's own keys follow the same
discipline: the **same discreet `?` help affordance the board uses** opens a small legend of its keymap
(move · open · drag-to-monitor · `t` back) and edge vocabulary, instead of a standing wall of text.

Isolation is the governing principle: the view runs in its **own** ReactFlow context (separate camera,
selection, store) and reads its **own** data (`GET /api/sessions/graph`, see [[sessions]]), so it cannot
break the board. While open it **owns the keyboard**, and on close the board is exactly as it was. It opens
**already framed** — the overlay waits for the first graph, then mounts with a viewport pre-computed from the
node bounds, so the first paint is centred on the web, never an empty screen that pans in a beat later.

Each node is a session, drawn with the **same** seed-to-hue colour and avatar the rest of the dashboard keys
off its session id ([[node-graph]]), so a face here matches that session everywhere. Layout is a **network**,
not a tree: sessions sit on a radial ring so the directed edges read as a web of relationships. A keyboard
cursor walks that web (arrow/hjkl move to the nearest node in a direction, the camera following); ⏎ opens
the focused session, the twin of a click — which **opens that session's console** by reusing the board's
existing open-session path, no new mechanism.

The edges are **derived from live watches, never user-drawn** (see [[sessions]]): the view only **polls**, so
a watch starting or stopping makes its arrow appear or vanish on its own, each drawn in the **watcher's** hue;
a global (`--all`) watcher shows arrows to every node. The backend derives edges only between live sessions,
so closing a session removes its node and arrows together — the graph never shows a dangling arrow.

Asking is the exception, faithful to the no-store rule. Dragging A→B **dispatches a prompt to agent A** (over
the same `/keys` channel the console uses) telling it to monitor B (`spex watch B`); **no subscription is
written**. The gesture must never fail for a reason the user can't see: on a ring nodes face arbitrary
directions, so any anchor connects to any other and only the drag's **direction** carries meaning — the node
the drag **started on is the watcher**, the other end the watched. To feel acknowledged at once, the moment
the drag completes an **optimistic pending edge** (dashed, in A's hue) appears with a brief **toast**; that
edge is provisional and **firms up to a solid live arrow** only once A's real `spex watch` registration
arrives on the next poll (a pending edge is superseded by its live twin, never doubled). Nodes stay draggable.
