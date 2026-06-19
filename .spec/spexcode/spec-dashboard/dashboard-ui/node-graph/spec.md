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
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
---
# node-graph

## raw source

Show the local neighbourhood and navigate by relationship — the full-forest view confused siblings with
cousins. The tree sits at fixed absolute positions and never re-plots: the viewpoint moves, only
highlight / dim / edge colour change per keystroke.

Each node is a small **two-row** tile, kept tight so the tree still fits on one screen. The top row is the
node's **identity** — what it is and its state. The second row is its **people** — who is editing it right
now, or, when nobody is, how long since it was last edited. A reader should see at a glance both "what is
this node" and "who/when". Node width is sized to let longer titles read (overflow ellipsises).

## expanded spec

Layout is horizontal, left→right — depth sets the column (root at the left), siblings stack as rows, and
parents centre vertically over their kids. Row and column spacing track the two-row node box so tiles never
touch. Edges read bold when they touch the focus, faint otherwise. Keys follow the same relationships (see
[[keyboard-nav]]).

**Row 1 — identity.** `status dot · title · version`, plus overlay marks. The dot reads the backend-**derived**
four-state value (see [[spec-node-states]]): green = merged, orange = active, yellow = drift, grey = pending;
active pulses, and drift shows its commits-ahead `⚠N` badge. A worktree's pending ops are stamped as glyphs —
`+` added, `~` edited, `✕` deleted, `→` moved — in the author session's colour, with a dashed ring while
uncommitted and an `added`-only node drawn as a translucent ghost. A node whose author session is live also
stamps a subtle `⏎` (click / Enter opens that session).

**Row 2 — people & recency.** A node's *live editors* are the sessions whose pending ops currently touch it
(the live overlay — never the historical `session` trailer). When there are any, the row shows one **avatar**
per editor, ringed by that session's liveness (working / idle / offline) and capped with a `+N` overflow.
When there are none, it falls back to **"last edited … ago"** (from the node's latest-version date), or
"no versions yet" for a node with no committed history.

Avatars are **deterministic and generated** from the session id: the dashboard has no real accounts, so a
stable face (colour + glyph + shape, hashed from the id) stands in for each session with no storage. Avatar
rendering is a **pluggable provider seam** — a higher-priority provider registered later (e.g. one mapping a
session id to a real image asset) swaps every avatar on the board with no change to the node renderer.

**One colour system.** Both a session's avatar face and its *labelling colour* — the node ring/overlay, the
`⏎` link, the reparent edge, and the session-row stripe — derive from the SAME hash of the SAME seed (the
session id), so a session's face and every mark that names it always share one hue (`color.js`:
`hash → hueFor → {avatarColors, labelColor}`). The backend no longer picks colours: it emits a stable `seed`
per worktree (its live session id, else its path) and the dashboard derives the colour. A worktree with no
session falls back to its path as the seed, so its overlays still get a stable colour.

A `moved` overlay also carries `toParent` (the node's *proposed* new parent); when it does, the board draws a
**faint dashed arrow** from the node to that parent, in the author session's colour, so a human can SEE the
reparent before it merges. It is deliberately subtle and overlaid on top of, never replacing, the solid tree
edges of the present structure.

Because this visual vocabulary is dense, a **floating legend** decodes it on demand (`?` toggles it, Esc
closes). It reads its swatches from the SAME `STATUS`/`GLYPH` constants the nodes render from, so it can never
drift from the real symbols. `?`/Esc are handled in the graph-mode branch of the capture-phase keydown
handler, below the modal guards, so the legend never disturbs (or is disturbed by) an open popup or session
interface.

The board and the session console are **bidirectionally linked**: a node's live editors map to live sessions
by exact id, so the same overlay that draws Row 2's avatars also drives the `⏎` affordance and Enter →
the session interface (see [[session-console]]). The reverse half: clicking a session row focuses its first
changed node. Nodes with no live editor just focus on click.
