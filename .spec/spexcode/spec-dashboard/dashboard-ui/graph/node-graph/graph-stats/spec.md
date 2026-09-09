---
title: graph-stats
status: active
hue: 210
session: 89e4d64b-8dde-4bd1-b60c-a3825caaba67
desc: The board census and its graph walk — shell-owned tallies count composition and attention once, while category clicks on the graph cycle through the nodes behind each count.
code:
  - spec-dashboard/src/GraphStats.jsx#nextGraphStatNode
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/specMeta.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
---
# board-stats

## raw source

The board showed *topology* but never *posture*: every number on it was point-of-data, pinned to one node
or one session. A reader could see the shape of the tree but not, at a glance, how big it was, how settled,
what needed a human, or how well-measured it was. Add a **statistics region** — a small always-on strip —
that says the whole-tree figures at a glance. Keep it honest and cheap: it **counts the per-node badges**
(distinct things, never double-counted), so it teaches no new vocabulary and asks nothing new of the backend.

## expanded spec

The census is **workspace state**, not graph chrome. The shell's `BoardStatus` is its one visual owner and
emits it once on every route through [[status-bar]]. `GraphStats` no longer registers an item or renders a
second HUD. This is the simpler boundary: the numbers remain true when the graph has never mounted, and a
hidden keep-mounted graph has no chrome lifetime it can accidentally leave behind. A graph-local HUD would
retain two presentation vocabularies for one board fact, so the valuable graph-only behavior — walking —
moves into the shell-owned tally instead.

The derivation remains one pure frontend pass over the same `specs` the board projects. Composition and
attention count distinct things, never badge sums: issues are deduped by number and drift counts affected
nodes. No endpoint, row array, or presentation-only category exists.

Two clusters, each answering one question:

- **Composition — what the tree IS.** The leading total names every spec node in the tree, followed by the four status dots (merged, active, drift, pending). Status dots are mutually exclusive and sum to that total: "how big, and how settled". Path names never create presentation-only partitions.
- **Attention — what NEEDS a human.** `⚠N` counts **nodes whose code is ahead of their spec**; `◆N` counts
  **distinct open issues** linked to the tree (deduped by number). Both count distinct things — an issue on
  three nodes is one issue. Lean per-node open ids provide only this dedupe/walk identity, never issue rows;
  the board only knows node-linked issues, so `◆` is the *linked* open set.

On the graph, every category chip is a **walk** at node granularity: clicking steps focus to the **next**
node it counts, entering at the first when focus is outside the ring and **wrapping**. The step remains the
shared `cycleNext` primitive ([[keyboard-nav]]). Off the graph, an issue category retains its board
navigation, while a node category enters the graph focused on the first matching node. A **zero-count**
chip dims and goes inert.
Desktop-only — it mounts in the graph shell the phone never renders ([[mobile-ui]]).

`GraphStats.jsx` now owns only the graph-specific `nextGraphStatNode` step and an inert mount boundary. The
visible composition is `BoardStatus` ([[status-bar]]); the dependency-free category pass stays in
`specMeta.js`. This division yields one derivation, one visual owner, and one graph navigation adapter
rather than two ledgers negotiating which one should stand down.
