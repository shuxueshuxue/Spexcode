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

One of three SpexCode packages (alongside spec-cli and spec-yatsu). The front end: a
node-graph where every node is a spec, navigated by logic. It reads `main` (the ground
truth) and overlays in-progress worktrees; each version change is attributed to a
Claude Code session.

Enter opens a node into switchable panes (**work / recent / history**), and the sidebar
splits into global statistics and focused-node information. The tool is named
**SpexCode**: npm packages are scoped `@spexcode/*`, the main-guard escape hatch is
`SPEXCODE_ALLOW_MAIN`, and the optional layout override is `spexcode.json` — the package
directory names (spec-cli, spec-dashboard, spec-yatsu) stay as components, not the brand.
