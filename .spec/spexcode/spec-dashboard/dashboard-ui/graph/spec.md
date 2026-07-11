---
title: graph
status: active
hue: 285
desc: The desktop graph page — the drill-down node tidy-tree and the surfaces that read and walk a single focused node on it: the tree canvas, its right owed-work column, its node popup, and the relationship keyboard.
---
The desktop reading of the spec tree is one **graph page**, not a handful of widgets: a tidy-tree of nodes plus the surfaces that hang off whichever node is **focused**. They share a subject (the focused node), a frame (one `App.jsx` grid against one stylesheet), and cross-reference each other — read together they answer a single question, *how do I see and move around the spec tree on a desktop*.

The react-flow canvas draws on a **clean `--paper` background** — no grid or dot pattern behind the tree — so the tiles and their edges are the only marks on the page.

- [[node-graph]] — the drill-down tidy-tree itself, the centre of the view; its bottom-left tally HUD ([[board-stats]]) mounts inside the tree shell.
- [[focus-panel]] — the right column that follows focus and lists the node's Issues and Scenarios.
- [[work-pane]] — the `i` node popup, the focused node's full reference record, opened over the page.
- [[keyboard-nav]] — relationship navigation: arrows walk focus by edge, not geometry, the camera following.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift; the shared shell, polled data, and stylesheet they mount against stay [[dashboard-shell]]'s. The phone's own touch face ([[mobile-ui]]) is deliberately *not* here: it answers the same question a different way, for a surface the pan/zoom/keyboard graph can't serve.
