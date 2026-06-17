---
title: spec-dashboard
status: active
session: sess-meta
hue: 210
desc: The front-end dashboard — a node-graph of specs, navigated by logic.
---
# spec-dashboard

One of three specMech packages (alongside spec-cli and spec-yatsu).

A node-graph where every node is a spec. Specs form a tree; each version change
is attributed to a Claude Code session. The dashboard reads `main` (the ground
truth) and overlays in-progress worktrees.
