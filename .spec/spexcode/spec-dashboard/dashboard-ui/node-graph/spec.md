---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots.
code:
  - spec-dashboard/src/SpecNode.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# node-graph

## raw source

Show the local neighbourhood and navigate by relationship — the full-forest view confused siblings with
cousins. The tree sits at fixed absolute positions and never re-plots: the viewpoint moves, only
highlight / dim / edge colour change per keystroke. A node is a thin single line, not a card, so tight
rows fit far more of the tree on one screen.

## expanded spec

Layout is horizontal, left→right — depth sets the column (root at the left), siblings stack as rows, and
parents centre vertically over their kids. Each node row is `status dot · title · version` — no box, no
thumbnail. Edges read bold when they touch the focus, faint otherwise. Keys follow the same relationships
(see [[keyboard-nav]]).

The status dot reads the backend-**derived** four-state value (see [[spec-node-states]]), not frontmatter:
green = merged, orange = active (a worktree is touching it), yellow = drift, grey = pending; active also
pulses, and drift still shows its commits-ahead count as a separate ⚠ badge. A worktree's pending ops are
stamped as overlay glyphs in the authoring session's colour — `+` added, `~` edited, `✕` deleted, `→`
moved — with a dashed ring while uncommitted and an `added`-only node drawn as a translucent ghost.

A `moved` overlay also carries `toParent` (the node's *proposed* new parent). When it does, the board
draws a **faint dashed arrow** from the node to that new parent, in the author session's colour, so a
human can SEE the reparent before it merges. It is deliberately subtle — low opacity, animated dashes,
an arrowhead — and overlaid on top of, never replacing, the solid tree edges of the present structure.

The board and the session console are **bidirectionally linked** by one fact: a node's `session` is the
id of the Claude Code session that authored it, and a live worktree runs under that same id (see
[[session-console]]). So a node whose author session is currently live maps to it by exact id match. Such
a node stamps a subtle `⏎` in the session's colour, and **clicking it** (or `Enter` on it) opens the
session interface focused on that session. The reverse half: clicking a session row focuses its first
changed node. Nodes with no live session just focus on click.

## current state

### description

The board is assembled by the backend (`buildBoard` → `/api/board`); `data.js`'s `loadBoard` is a thin
fetch that decorates only the x/y tidy-tree layout (`X_GAP`/`Y_GAP` post-order placement) — every other
field, including overlays, ghosts, drift and sessions, comes from the backend. `App.jsx` builds the
react-flow `nodes`/`edges`: fixed positions, kin-vs-`is-far` dimming (or `ov-hot`/`ov-dim` when a session
is highlighted), and a `data.link` decoration on nodes whose author session is live. The `edges` memo
emits the solid tree edges plus, for any node whose overlays include a `moved` with a resolvable
`toParent`, a faint dashed `move-edge` (animated, arrow-headed, session-coloured) from the node to its
proposed new parent — the reparent preview. `SpecNode.jsx`
renders the row: a `STATUS`-coloured dot (with a pulse for `active`), title, the `⏎` session affordance
when `data.link` is set, the `⚠{drift}` badge when `drift > 0`, the version, and the dedup'd op glyphs;
`ghost`/`deleted`/`has-overlay`/`ov-dirty` classes carry the overlay styling from `styles.css`. The camera
flat-pan and the click→focus/open-session handlers live in `App.jsx` alongside [[keyboard-nav]].

### verdict — not drifted

All four governed files sit at or behind this node's latest version with no commits ahead after this
change (`spex lint` reports no `drift` warning for `node-graph`); `App.jsx` and `styles.css` carry the
reparent-preview edge and ship in the same commit as this spec, so neither drifts. The expanded spec
states the map's intended behavior; the description is the honest read of how the four files realise it
today. The derived four-state dot, the drift badge, the overlay glyphs, the board↔session link, and the
reparent-preview arrow were folded into the expanded spec as they landed, not back-written after the
fact — the raw source (a fixed local-neighbourhood tree of thin rows, viewpoint moves not layout) still
holds.
