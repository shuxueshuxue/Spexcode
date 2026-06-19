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
existing view. `t` toggles it; Esc returns. It is **observational**: the arrows reflect who is watching
whom right now and appear/disappear as watches start and stop — there is nothing for a human to draw or
delete.

## expanded spec

`t` (an otherwise-unbound board key, so it shadows no nav) opens a full-screen session-graph over the
board; Esc returns. Isolation is the governing principle: the view runs in its **own** ReactFlow context
(separate camera, selection, store) and reads its **own** data (`GET /api/sessions/graph`, see
[[sessions]]) — it shares no state with the board, so it cannot break it. While it is open it **owns all
keys** (the board's keydown shell yields to it), and on close the board is exactly as it was.

Each node is a session, rendered with the **same** seed-to-hue colour and generated avatar the rest of
the dashboard keys off its session id ([[node-graph]] · `color.js` / `avatar.jsx`), so a face here is the
same face that session shows everywhere. Layout is a **network**, not a tree — sessions sit on a radial
ring so the directed edges read as a web of relationships, not a hierarchy. Each edge is a **live
monitor** drawn in the **watcher's** hue.

The edges are **derived from live watches, not user-drawn** (see [[sessions]]): the view **does not
create or remove** them, so nodes are draggable to arrange the layout but not connectable, and edges are
not interactive. It **polls** the endpoint, so a watch starting or stopping makes its arrow appear or
vanish on its own; a global (`--all`) watcher shows as arrows to every node. Closing a session removes it
as a node and its arrows vanish with it, because the backend only derives edges between live sessions —
the graph never shows a dangling arrow.
