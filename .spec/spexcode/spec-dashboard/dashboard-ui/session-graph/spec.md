---
title: session-graph
status: active
hue: 280
desc: Experimental — sessions as a directed political network; t opens it, drag to subscribe, arrows persist.
code:
  - spec-dashboard/src/SessionGraph.jsx
---

# session-graph

## raw source

Sessions are not only spec-editors — they are **agents that can relate to each other**. Show them as a
**directed political network**: each session a node, each *subscription* (A subscribes to B) a directed
arrow A→B. The view is **experimental and isolated** — it must drop in without disturbing the spec board
or any existing view. `t` toggles it; Esc returns. Let a human **create** a subscription by drawing an
edge between two sessions and **remove** one just as directly; the network must survive a reload.

## expanded spec

`t` (an otherwise-unbound board key, so it shadows no nav) opens a full-screen session-graph over the
board; Esc returns. Isolation is the governing principle: the view runs in its **own** ReactFlow context
(separate camera, selection, store) and reads its **own** data (`GET /api/sessions/graph`, see
[[sessions]]) — it shares no state with the board, so it cannot break it. While it is open it **owns all
keys** (the board's keydown shell yields to it), and on close the board is exactly as it was.

Each node is a session, rendered with the **same** seed-to-hue colour and generated avatar the rest of
the dashboard keys off its session id ([[node-graph]] · `color.js` / `avatar.jsx`), so a face here is the
same face that session shows everywhere. Layout is a **network**, not a tree — sessions sit on a radial
ring so the directed edges read as a web of relationships, not a hierarchy. Each subscription is a
directed arrow drawn in the **subscriber's** hue.

The human **creates** a subscription by dragging from one node to another (any pair, in any direction)
and **removes** one by clicking its arrow; each gesture calls the persistence endpoints, so the network
**survives a reload** (the edges are durable runtime state — see [[sessions]]). A self-edge is rejected.
Closing a session removes it as a node and its arrows vanish with it, because the backend prunes edges to
live endpoints — the graph never shows a dangling arrow.
