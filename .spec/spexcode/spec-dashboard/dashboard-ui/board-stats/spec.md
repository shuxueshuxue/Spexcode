---
title: board-stats
status: active
hue: 210
session: 89e4d64b-8dde-4bd1-b60c-a3825caaba67
desc: A glanceable bottom-left strip that totals the per-node badges across the whole tree — composition (status dots), attention (drift + open issues), coverage (yatsu circles) — and turns each total into a jump to the first node it counts.
code:
  - spec-dashboard/src/BoardStats.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
---
# board-stats

## raw source

The board showed *topology* but never *posture*: every number on it was point-of-data, pinned to one node
or one session. A reader could see the shape of the tree but not, at a glance, how big it was, how settled,
what needed a human, or how well-measured it was. Add a **statistics region** — a small always-on strip —
that says the whole-tree totals at a glance. Keep it honest and cheap: it is just **the per-node badges,
summed**, so it teaches no new vocabulary and asks nothing new of the backend.

## expanded spec

A glanceable strip pinned to the **bottom-left** of the [[node-graph]] (always on, never covering the graph;
it shares the minimal-HUD chrome — a paper chip in mono type). It reads the **same `specs` the graph plots**,
so it stays in lock-step with the tiles, and it is **pure frontend derivation**: every number folds in one
pass from the `/api/board` payload the board already polls (status, `drift`, `openIssues`, `evals`), so there
is **no new endpoint and no new visual vocabulary** — each figure is the literal sum of a glyph the tiles
already wear and the legend already decodes.

Three clusters, divider-separated, each answering one question:

- **Composition — what the tree IS.** A leading total, then the four **status dots** counted
  (●merged · ●active · ●drift · ●pending, the same colours and square ticks the tiles use). The four are
  mutually exclusive and sum to the total, so the cluster reads as "how big, and how settled".
- **Attention — what NEEDS a human.** `⚠N` = the per-node drift figures summed (commits of code ahead of
  spec, tree-wide, in the tiles' yellow) and `◆N` = open issues summed (in the tiles' magenta). These are the
  literal totals of the `⚠`/`◆` badges, not node counts — the depth of the backlog, not just its breadth.
- **Coverage — how well-MEASURED the tree is.** The yatsu **score circles** counted, one vocabulary with the
  tiles ([[yatsu-score-badge]]): `✓` fresh passing, `✗` fresh failing, a single `⊘` folding both stale
  verdicts, and — only when there is one — the faint **empty ring** for a *blind spot*: a node that declares
  scenarios but has no current verdict (`nodeScore` → `empty`). This counts what the frontend can honestly
  see; it is **not** a "should have a scenario but doesn't" census (that judgement lives in `spex yatsu scan`,
  not the board payload), so the strip never claims coverage it cannot prove.

Every chip is a **jump, not just a number**: clicking it focuses the **first** node it counts (board order),
and the focus follows-through drills that node's spine open and pans the camera to it — the same motion a
search pick performs. A **zero-count** chip dims and goes inert: there is nowhere to jump, and a row of dim
zeros reads as "all clear". The whole strip is desktop-only — it mounts inside the graph shell, which the
phone never renders ([[mobile-ui]]).

The component (`BoardStats.jsx`) is this node's only owned source. It is **mounted by the shared App shell**
the same way the session window rides there, and it **adds to two shared surfaces without owning them**: a
`.board-stats` block in the dashboard's shared stylesheet ([[node-graph]] keeps `styles.css`) and a `stats`
section in the i18n dictionaries it does own. So a later change to the App shell or the graph is *their*
node's concern, never a phantom drift on this strip.
