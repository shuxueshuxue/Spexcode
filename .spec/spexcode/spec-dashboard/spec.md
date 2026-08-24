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

The no-predecessor exception is explicit for the current renderer arrivals: `@codemirror/lang-javascript`,
`@codemirror/language`, `@codemirror/merge`, `@codemirror/state`, `@codemirror/view`, `@lezer/highlight`,
`katex`, and `markdown-it`. CodeMirror owns the SourceView and DiffDocument editor faces; KaTeX and markdown-it
own RichText. Each replaced a local hand-renderer or parser boundary, so there is no old package edge to subtract.
This list is executable: `spec-dashboard/src/dependencyBoundary.test.mjs` fails if a listed package or this
exception disappears from the contract.

### Historical arrival ledger

The package boundary is also accounted for historically; each arrival names the edge or in-tree owner it replaced.
The commit ids below are the repository's immutable evidence, not a reconstruction from the current manifests.

| Commit | Arrival | Predecessor or removal in the same boundary change |
| --- | --- | --- |
| `7e90b791d` (2026-08-09) | Extracted the shared workspace core as `@spexcode/l0` under `packages/l0`. | The former in-tree owners were moved out of `spec-cli/src` (anchors, git/layout, graph, identity, resilience, specs, review snapshot, and root-LRU); Git records these as renames, so no parallel package edge remained. |
| `023e91b4c` (2026-08-09) | Renamed `@spexcode/l0` to `@spexcode/spec-core`. | The `@spexcode/l0` package name and path were renamed in one commit; this is a replacement, not an additional shared-core dependency. |
| `dff2d31c7` (2026-08-11) | Made `@spexcode/spec-core` importable and packable outside the monorepo. | The predecessor was the internal-only source package; the commit adds the package build/pack boundary and does not add a second core implementation. |
| `3d0e60e6b` (2026-08-12) | Formalized `spec-dashboard -> @spexcode/spec-cli`/`@spexcode/spec-core` and `spec-cli -> @spexcode/spec-core`/`@spexcode/spec-eval`/`@spexcode/spec-forge` edges. | Dashboard `SpecSearch` replaced `../../spec-cli/src/ranker.ts` with the public `@spexcode/spec-cli/ranker` export, and the CLI's `../../spec-eval`/`../../spec-forge` imports were replaced by package exports in the same change. |

The ledger closes the historical `spec-cli`/`spec-core` boundary gap: later dependency additions still need either a
same-change predecessor removal or the explicit no-predecessor exception above.
