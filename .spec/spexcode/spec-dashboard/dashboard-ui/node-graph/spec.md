---
title: node-graph
status: merged
session: sess-graph
hue: 280
desc: A stable tree map; the viewpoint moves, the tree never re-plots.
code:
  - spec-dashboard/src/SpecNode.jsx
  - spec-dashboard/src/Legend.jsx
  - spec-dashboard/src/data.js
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

Because this visual vocabulary is dense, a **floating legend** decodes it on demand. Pressing `?` toggles
a small fixed corner card (Esc also closes it) that lists every symbol above: the four status-dot colours,
the `+`/`~`/`✕`/`→` overlay-op glyphs, the `⏎` live-session affordance, the `⚠N` drift badge, the `vN`
version, the dashed-vs-solid (uncommitted-vs-committed) ring whose colour is the author session, and the
translucent ghost of an added node. The legend is unobtrusive — it floats over the board without blocking
graph interaction, and it reads its swatches from the SAME `STATUS`/`GLYPH` constants the nodes render
from, so it can never drift from the real symbols. `?`/Esc are handled in the graph-mode branch of the
capture-phase keydown handler, below the modal guards, so the legend never disturbs (or is disturbed by)
an open node-info popup or session interface.

The board and the session console are **bidirectionally linked** by one fact: a node's `session` is the
id of the Claude Code session that authored it, and a live worktree runs under that same id (see
[[session-console]]). So a node whose author session is currently live maps to it by exact id match. Such
a node stamps a subtle `⏎` in the session's colour, and **clicking it** (or `Enter` on it) opens the
session interface focused on that session. The reverse half: clicking a session row focuses its first
changed node. Nodes with no live session just focus on click.
