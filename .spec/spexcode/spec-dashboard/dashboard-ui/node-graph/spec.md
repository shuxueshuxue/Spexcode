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

Show the local neighbourhood and navigate by relationship — the full-forest view
confused siblings with cousins.

The tree sits at fixed absolute positions and never re-plots: the viewpoint moves (a
flat constant-zoom pan that centres the focus), and only highlight / dim / edge
colour change per keystroke. Layout is horizontal, left→right — depth sets the column
(root at the left), siblings stack as rows, and parents centre vertically over their
kids. Each node is a thin single line (status dot · title · version) — no box, no
thumbnail — so tight rows fit far more of the tree on one screen. Edges read bold when
they touch the focus, faint otherwise. Keys follow the same relationships (see
[[keyboard-nav]]).

The status dot reads the backend-**derived** four-state value (see [[spec-node-states]]), not
frontmatter: green = merged, orange = active (a worktree is touching it), yellow = drift, grey =
pending; active also pulses, and drift still shows its commits-ahead count as a separate ⚠ badge.
A worktree's pending ops are stamped as overlay glyphs in the authoring session's colour — `+`
added, `~` edited, `✕` deleted, `→` moved — with a dashed ring while uncommitted.

The board and the session console are **bidirectionally linked** by one fact: a node's `session` is the
id of the Claude Code session that authored it, and a live worktree runs under that same id (see
[[session-console]]). So a node whose author session is currently live maps to it by exact id match.
Such a node stamps a subtle `⏎` in the session's colour, and **clicking it** (or pressing Enter on it —
the same key that opens the session interface, see [[keyboard-nav]]) opens the session interface focused
on that session. The reverse half stays as-is: clicking a session row focuses its first changed node.
Nodes with no live session just focus on click, so the gesture is unchanged for the rest of the tree.
