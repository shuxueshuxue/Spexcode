---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/App.jsx
---
# keyboard-nav

## raw source

Move by relationship on a stable, depth-aligned tree — not by raw pixel distance. The tree never
re-plots; the camera moves. A Van Wijk zoom arc once made switching nodes "jump too high", so the
camera must flat-pan at constant zoom, never zoom-to-fit.

The **camera follows the keyboard, not the mouse**. Arrow-key navigation and mouse selection are
different interaction logics: walking the tree by arrow keys recentres the viewport on the new node
(you asked to go there), but clicking a node only moves the highlight — the camera stays put (you're
pointing, not travelling). Conflating them made clicks yank the board around.

A node does **not belong to a session**. `node.session` is only the *last editor* (attribution), not a
live link. The live link is the overlay — the session(s) currently editing a node — and that is what
the friction-reducer crosses into.

## expanded spec

`←` / `→` go to the parent / nearest child (the child closest in y). `↑` / `↓` move within the focused
node's **column** to the nearest node in that direction: depth pins x exactly (`x = depth · X_GAP`), so
a column is a clean vertical line and vertical nav never changes column or dives into a child. Columns
are aligned and rows aren't, so we navigate the organised axis — and it's reversible, since a column's
nodes are already ordered in y. `+` / `-` zoom, `0` resets to the overview zoom.

A keystroke only ever changes the *viewpoint* and the highlight / dim / edge state — the tree sits at
fixed absolute positions (see [[node-graph]]). Arrow-key focus changes recentre the camera on the new
node; **mouse-click focus does not pan** (it only moves the highlight) — same focus state, two
interaction logics. `i` opens the node-info popup ([[work-pane]] / [[ab-screenshots]]); `Enter` crosses
to the focus node's session (see below). While a modal (popup or session interface) is open it **owns**
the keys: arrows must not leak through to pan the board behind it — that was the old blind-navigation bug.

The node-info popup keeps the keys close to the node world it overlays. Its three panes (spec / recent /
history) switch by `←` / `→` (cycling, wrapping at the ends) just as they do by `Tab` and `1`-`3` —
inside the popup, horizontal arrows mean "switch pane", never "move the board".

And the popup is a launchpad, not a dead end: `Enter` crosses straight from *reading* a node to
*driving* its agent. The destination is the **live overlay** — the session(s) whose pending ops touch
this node — never `node.session` (which is only the last editor, usually closed). So `Enter` (in the
popup or on the board) resolves by how many sessions are live on the focus node: **one** → jump straight
into it; **none** → open New Session prefilled with `@<node-id>` (start working on it in place);
**several** → open the session interface so the human picks which editor to drive. One key carries the
reader from the node world into the session world, so inspecting a node and taking it over are not two
separate gestures. `node.session` survives only as a "last edited by" line in the popup's meta.

In `App.jsx` this is one capture-phase `keydown` listener that wins over react-flow. In graph mode `↑`/`↓`
call `nearestY('up'|'down')` (a same-x column scan for the nearest node in y), `←`→`parent`, `→`→the child
nearest in y; all four go through `go(t)`, which sets focus **and** `centerOn(t)` — so arrow nav is the
only thing that pans. `=`/`+` and `-`/`_` zoom by 1.2×, `0` resets to the overview zoom; `i` opens the info
popup; `Enter` calls `crossToSession(focus)`. The camera is a plain rAF pan (`animateView` → `setViewport`,
cubic ease) that recentres at constant zoom — no fit, no arc; a `framedRef`-guarded effect frames the root
once on mount and never re-pans on its own, and `onNodeClick` only `setFocusId(n.id)` — so polling and
mouse clicks never move the board (the camera follows the keyboard alone). `crossToSession(node)` reads the
live overlay via `liveEditorsOf(node)` = `sessions.filter(s => s.ops?.some(op => op.nodeId === node.id))`:
one editor → `openSession(editors[0].id)`; none → `openSession('new')` (the New Session tab prefills
`@node.id` because `SessionInterface` reads `focusNode=focus`); several → `setSessionUI(true)` to let the
human pick. A node carrying live editor(s) gets a `link` so `SpecNode` stamps the subtle `⏎` affordance
(first editor's colour/status). When a modal is open the handler short-circuits: the session interface
swallows all keys but `Escape`; the info popup handles `Escape`, `Tab` / `←` / `→` / `1`-`3` (pane
switching, `←`/`→` calling the same `cyclePane(±1)` as `Tab`) and `Enter` (which `setOverlay(false)` then
`crossToSession(focus)`), and still drops `↑`/`↓` so they never reach the board; the key hints render in
the HUD. `App.jsx` also hosts the graph render (node positions, edges, and the faint dashed reparent-preview
arrow for `moved` overlays — see [[node-graph]]), but those are view concerns that never change the
navigation contract above.
