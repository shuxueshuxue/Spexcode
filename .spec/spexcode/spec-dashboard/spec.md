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

Enter opens a node into switchable panes (**spec / history / issues**, plus an **edit**
pane that appears only while the node has a pending overlay), and the sidebar splits into
global statistics and focused-node information. The whole UI is rendered through an
**i18n provider** wrapping the app, so every surface reads its copy from a locale rather
than hardcoded strings. The tool is named **SpexCode**: npm packages are scoped
`@spexcode/*`, the main-guard escape hatch is `SPEXCODE_ALLOW_MAIN`, and the optional
layout override is `spexcode.json` — the package directory names (spec-cli,
spec-dashboard, spec-yatsu) stay as components, not the brand.
