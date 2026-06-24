---
title: session-graph
status: active
hue: 280
desc: Experimental — sessions as a directed monitor network; the session console's "View Session Relationship" tab, edges = live `spex watch`.
code:
  - spec-dashboard/src/SessionGraph.jsx
---

# session-graph

## raw source

Sessions are not only spec-editors — they **watch each other**. Show them as a **directed monitor
network**: each session a node, each *live monitor* (agent A running `spex watch B`) a directed arrow
A→B. The view is **experimental and isolated** — it must drop in without disturbing the spec board or any
existing view. It lives as a tab **inside the session console** ([[session-console]]): the **"View Session
Relationship"** view, reached by its icon button (paired with `＋ New Session` in the console's top button
row) or — from the spec board — the small floating network button, which opens the
console **on this tab**. The arrows are **observational** — they reflect who is watching whom right now and
appear/disappear as watches start and stop. The one human gesture is **asking**: dragging A→B does not draw
a stored edge, it **asks agent A to monitor B**. Clicking a node **opens that session's console** — which,
since the graph and the consoles are sibling tabs of one board, simply switches to that session's tab.

## expanded spec

Isolation is the governing principle: the view runs in its **own** ReactFlow context (separate camera,
selection, store), so even sitting in the console's content pane it cannot disturb the spec board or any
other ReactFlow. Its **nodes are the shared preloaded session list** the console already holds (the same
`sessions` every surface reads); only the **edges** are its own poll (`GET /api/sessions/graph`, see
[[sessions]]). So it **fills the pane** and opens **instant and already framed** — the nodes are there on the
first render, never a cold fetch to block behind, and the **first visible frame is already centred**: opening
is **motionless**, with no corner-to-centre pan or zoom-to-fit playing out after the pane appears. This holds
on **every reselect** — the tab remounts each time it's picked, yet never replays an intro — matching the
board graph's settled stillness. Only a later session-count change reframes, with a gentle pan.

The **console owns the arrows and Esc** ([[keyboard-nav]], [[session-console]]); what is **left** to this
view is the in-graph walk. You reach the tab from an **empty** New Session with **→** and leave it with **←**
(a horizontal axis off New, the twin of the vertical session list) — the other arrows are **inert** here.
Esc closes the view's `?` legend first, else the console. So the graph's cursor is **vim-only**: **hjkl** move
it to the nearest node inside a 45° cone in that direction (the camera following), and **⏎** opens the focused
session — the twin of a click, which **switches to that session's console tab**. The view's own keys keep the
board's discipline: the **same discreet `?` help affordance the board uses** opens a small legend of its
keymap and edge vocabulary, instead of a standing wall of text.

Each node is a session, drawn with the **same** seed-to-hue colour and avatar the rest of the dashboard keys
off its session id ([[node-graph]]), so a face here matches that session everywhere. Layout is a **network**,
not a tree: sessions sit on a radial ring so the directed edges read as a web of relationships.

The edges are **derived from live watches, never user-drawn** (see [[sessions]]): the view only **polls**,
so a watch starting or stopping makes its arrow appear or vanish on its own, each drawn in the
**watcher's** hue; a global (`--all`) watcher shows arrows to every node. The backend derives edges only
between live sessions, so closing a session removes its node and arrows together — the graph never shows a
dangling arrow.

Asking is the exception, faithful to the no-store rule. Dragging A→B **dispatches a prompt to agent A** (over
the same `/keys` channel the console uses) telling it to monitor B (`spex watch B`); **no subscription is
written**. The gesture must never fail for a reason the user can't see: on a ring nodes face arbitrary
directions, so any anchor connects to any other and only the drag's **direction** carries meaning — the node
the drag **started on is the watcher**, the other end the watched. To feel acknowledged at once, the moment
the drag completes an **optimistic pending edge** (dashed, in A's hue) appears with a brief **toast**; that
edge is provisional and **firms up to a solid live arrow** only once A's real `spex watch` registration
arrives on the next poll (a pending edge is superseded by its live twin, never doubled). Nodes stay draggable.
