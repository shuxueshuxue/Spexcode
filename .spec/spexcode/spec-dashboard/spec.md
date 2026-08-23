---
title: spec-dashboard
status: active
session: sess-meta
hue: 210
desc: The front-end dashboard — a node-graph of specs, navigated by logic.
code:
  - spec-dashboard/src/main.jsx
related:
  - spec-dashboard/package.json
---
# spec-dashboard

The dashboard is the `@spexcode/spec-dashboard` package. It declares its `@spexcode/spec-core` and
`@spexcode/spec-cli` dependencies explicitly; search ranking is consumed from the CLI package's public
`ranker` export rather than reaching across directories.

One of three SpexCode packages (alongside spec-cli and spec-eval). The front end: a
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
spec-dashboard, spec-eval) stay as components, not the brand.

## Dependency accounting

Every direct dashboard dependency has a live importer or an explicit boundary reason. The CodeMirror CM6
family (`@codemirror/*` and `@lezer/highlight`) owns the virtualized read-only source and merge-diff faces;
`katex` and `markdown-it` own the single rich-conversation renderer. These arrivals have no predecessor to
remove: the prior surfaces were hand-rendered and had no replaceable package edge. `@spexcode/spec-core` is the
browser-safe shared authority, while `@spexcode/spec-cli` is retained only for its public `ranker` export.
The desktop Electron dependency is deliberately outside the root workspaces in `spec-desktop/package.json`, so
users who do not run the optional shell do not ingest its runtime. A dependency may be added without a removal
only under one of these measured exceptions; otherwise the owning feature must remove its superseded edge in the
same change.
