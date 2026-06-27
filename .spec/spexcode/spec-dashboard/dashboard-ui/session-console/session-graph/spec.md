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
appear/disappear as watches start and stop. The two human gestures are **opening** and **asking**:
**double-click** a node to **open that session's console** (since the graph and the consoles are sibling tabs
of one board, this simply switches to that session's tab); and to **ask** a monitor, **left-click** a node to
pick it as the watcher, then **right-click** another node — the watched — to ask the first to monitor the
second. Asking does not draw a stored edge.

## expanded spec

Isolation is the governing principle: the view runs in its **own** ReactFlow context (separate camera,
selection, store), so even sitting in the console's content pane it cannot disturb the spec board or any
other ReactFlow. Its **nodes are the shared preloaded session list** the console already holds (the same
`sessions` every surface reads), and its **edges** — the live monitor + comms network (`GET
/api/sessions/graph`, see [[sessions]]) — are polled by the **console itself** ([[session-console]]), the
**always-mounted** owner, **not** by this tab. That matters: the tab **remounts on every reselect**, so a poll
living inside it would **cold-refetch each time** and flash an **edgeless placeholder** that then re-settles
and **jumps** once the first edge poll lands. Owning the edges one level up means **both** the nodes **and**
the live edges are in hand on the **first render**, so the **first visible frame is already the final
force-clustered web** — the relationships are baked into the layout from the start, never drawn in a few
seconds later over a re-arranging graph. The reveal is **held until the edges land** (the mask lifts on the
first edge response, even an empty one), so what first appears is the settled final frame, **already centred**:
opening is **motionless**, with no corner-to-centre pan, no zoom-to-fit, and no edges-then-relayout shuffle
playing out after the pane appears. This holds on **every reselect** — the in-hand edges are **reused** (no
cold refetch), so it frames the final web **instantly** and never replays an intro — matching the board
graph's settled stillness. And because the console keeps polling in the **background**, the web stays
**current on its own**: a new watch or a rising comms count appears **live**, without a tab round-trip to
refresh it. Only a session-count change **reframes** (a gentle pan); a topology change (a watch or comms
edge starting or stopping) **re-settles the web in place**, within the existing frame.

The **console owns the arrows and Esc** ([[keyboard-nav]], [[session-console]]); what is **left** to this
view is the in-graph walk. You reach the tab from an **empty** New Session with **→** and leave it with **←**
(a horizontal axis off New, the twin of the vertical session list) — the other arrows are **inert** here.
Esc closes the view's `?` legend first, else the console. So the graph's cursor is **vim-only**: **hjkl** move
it to the nearest node inside a 45° cone in that direction (the camera following), and **⏎** opens the focused
session — the twin of **double-clicking** a node, which **switches to that session's console tab**. The view's own keys keep the
board's discipline: the **same discreet `?` help affordance the board uses** opens a small legend of its
keymap and edge vocabulary, instead of a standing wall of text.

Each node is a session, drawn with the **same** seed-to-hue colour and avatar the rest of the dashboard keys
off its session id ([[node-graph]]), so a face here matches that session everywhere — and **labelled with the
same headline its session row and console title show** (`sessionHeadline`: a human rename, else the worker's
**live tmux self-summary** — the agent's own description of what it's doing — else the launch-prompt preview),
**not** a divergent stable-id name. So a node here reads as the very same session you see in the list, and the
two stay identifiable as the agent renarrates. Layout is a **network**,
not a tree, and **not a fixed ring** — it is **force-directed**: related sessions are pulled together into
**clusters** while unlinked ones drift to the margins, so the edges stay **short** instead of slashing straight
across a ring. It is **deterministic and still** — the same topology always yields the same frame, and the web
**re-settles only when the topology changes** (a watch starting or stopping, a session opening or closing), so
across the edge polls it never jitters. Edges anchor **border-to-border** rather than to fixed handles, so an
arrow leaves and lands cleanly whichever way two nodes settle.

The edges are **derived from live watches, never user-drawn** (see [[sessions]]): the view only **polls**,
so a watch starting or stopping makes its arrow appear or vanish on its own, each drawn in the
**watcher's** hue; a global (`--all`) watcher shows arrows to every node. The backend derives edges only
between live sessions, so closing a session removes its node and arrows together — the graph never shows a
dangling arrow.

Asking is the exception, faithful to the no-store rule. Asking A to monitor B **dispatches a prompt to agent
A** (over the same `/keys` channel the console uses) telling it to monitor B (`spex watch B`); **no
subscription is written**. The gesture is **two clicks, not a drag**: you **left-click** a node to pick it as
the **watcher** (it lights up as the selected source), then **right-click** another node — the watched.
Direction lives in the order of the two clicks, so no handle and no drag is needed; left-clicking a different
node re-picks the source, and a click on empty space clears it. The gesture has no visible handle, but the
view does **not** stand a permanent caption over the graph to advertise it: clicking a node is itself the
intuitive first move and needs no prompt to remind the user to make it. Instead the hint is **reactive** —
it surfaces only once the user engages. Picking a source raises a brief **toast** that does **not** re-announce
which node was clicked (the user plainly sees that) — it only states the next step: right-click the node *this
one* should monitor. A right-click with nothing picked yet just reminds the user to pick first; the full
click-then-right-click rule also lives in the `?` legend for anyone who looks. Double-clicking to open needs
no such hint — it is the conventional open gesture. To feel acknowledged at once, the moment the right-click lands an **optimistic pending edge** (dashed,
in A's hue) appears with a brief **toast**; that edge is provisional and **firms up to a solid live arrow**
only once A's real `spex watch` registration arrives on the next poll (a pending edge is superseded by its
live twin, never doubled). Nodes stay draggable.
