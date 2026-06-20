---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots. Each node shows its identity and its people.
code:
  - spec-dashboard/src/SpecNode.jsx
  - spec-dashboard/src/avatar.jsx
  - spec-dashboard/src/color.js
  - spec-dashboard/src/Legend.jsx
  - spec-dashboard/src/Modal.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
---
# node-graph

A stable tidy-tree map of the spec-node neighbourhood: navigate by **relationship**, not by hunting a full forest where siblings blur into cousins. The tree sits at **fixed absolute positions and never re-plots** — per keystroke the viewpoint moves; only highlight / dim / edge colour change. Layout is horizontal left→right: depth is the column (root at the left), siblings stack as rows, parents centre over their children, tiles never touch, and edges read bold when they touch the focus, faint otherwise. Keys follow the same relationships (see [[keyboard-nav]]).

Each node is a tight **two-row tile** — not a card — so the whole tree fits one screen; a reader sees at a glance both *what this node is* and *who/when*.

**Row 1 — identity:** `status dot · title · version` plus overlay marks. The dot shows the backend-**derived** four-state (see [[spec-node-states]]): green merged, orange active (pulsing), yellow drift (with a commits-ahead `⚠N` badge), grey pending. A worktree's pending ops stamp glyphs in the author session's colour — `+` added, `~` edited, `✕` deleted, `→` moved — with a dashed ring while uncommitted; an `added`-only node draws as a translucent ghost. A live author session also stamps a subtle `⏎` (click / Enter opens that session).

**Row 2 — people & recency:** a node's *live editors* are the sessions whose pending ops currently touch it (the live overlay, never the historical `session` trailer). With editors, one **avatar** each ringed by liveness and capped with `+N`; with none, it falls back to **"last edited … ago"**, or "no versions yet" when there is no committed history.

**Avatars** are deterministic, generated from the session id (the dashboard has no real accounts). Rendering is a **pluggable provider seam**: a higher-priority provider registered later (e.g. id → real image) swaps every face with no change to the node renderer.

**One colour system.** A session's avatar face and its *labelling colour* — node ring/overlay, the `⏎`, the reparent edge, the session-row stripe — derive from the SAME hash of the SAME seed (the session id), so a session's face and every mark that names it share one hue. The backend emits a stable `seed` per worktree (its live session id, else its path); the dashboard derives the colour.

A **leaf** node carries a small `+` button on its right edge (revealed on hover/focus): a SECOND entry to the `nn` new-node chord (see [[keyboard-nav]]) that opens the New Session tab pre-seeded with `@new under @<id>` for that node. It is purely additive — it never moves focus/selection.

A `moved` overlay carrying `toParent` draws a **faint dashed arrow** to the node's proposed new parent, in the author session's colour, so a human SEES the reparent before it merges — overlaid on, never replacing, the solid tree edges.

Because this vocabulary is dense, a **floating legend** decodes it on demand (`?` toggles, Esc closes), reading its swatches from the SAME constants the nodes render from so it can never drift. The legend and the [[settings]] popup share one centered-modal chrome (`Modal.jsx`).

The board and the session console are **bidirectionally linked**: live editors map to live sessions by exact id, driving both Row 2's avatars and the `⏎` → session interface (see [[session-console]]); clicking a session row focuses its first changed node, and nodes with no live editor focus on click.
