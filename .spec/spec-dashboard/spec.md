---
title: spec-dashboard
status: active
session: sess-meta
hue: 210
desc: The front-end dashboard — a node-graph of specs, navigated by logic.
code:
  - spec-dashboard/src/main.jsx
---
# spec-dashboard

One of three SpexCode packages (alongside spec-cli and spec-yatsu).

A node-graph where every node is a spec. Specs form a tree; each version change
is attributed to a Claude Code session. The dashboard reads `main` (the ground
truth) and overlays in-progress worktrees.

## v2
- Enter opens a node into switchable panes: spec / terminal / evidence / history.
- The sidebar is split into global statistics and focused-node information.

## v3 — named SpexCode
The tool has a name now: **SpexCode**. The npm packages move to the `@spexcode/*`
scope, the main-guard escape hatch becomes `SPEXCODE_ALLOW_MAIN`, and the optional
layout-override file is `spexcode.json`. The package directory names (spec-cli,
spec-dashboard, spec-yatsu) stay as they are — those are components, not the brand.
