---
title: board-stats
status: active
hue: 210
session: 89e4d64b-8dde-4bd1-b60c-a3825caaba67
desc: A glanceable bottom-left strip that counts the per-node badges across the whole tree — composition (status dots), attention (drift nodes + distinct open issues), coverage (yatsu circles) — and walks focus through the nodes behind any chip, one per click.
code:
  - spec-dashboard/src/BoardStats.jsx
related:
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

A strip pinned to the **bottom-left** of the [[node-graph]], always on, sharing the minimal-HUD chrome. It
reads the **same `specs` the graph plots**, so it stays in lock-step with the tiles, and it is **pure
frontend derivation** — every figure folds from the `/api/board` poll, no new endpoint and no new vocabulary.
Each figure is a **count of distinct things**, never a sum of badges: summing per-node badges double-counts
whatever spans nodes (an issue linked to several nodes; a shared file that drifts under all its owners), so
the strip counts the underlying things once.

Three clusters, each answering one question:

- **Composition — what the tree IS.** A leading total, then the four **status dots** counted (●merged ●active
  ●drift ●pending, the tiles' colours). Mutually exclusive, summing to the total: "how big, and how settled".
- **Attention — what NEEDS a human.** `⚠N` counts **nodes whose code is ahead of their spec**; `◆N` counts
  **distinct open issues** linked to the tree (deduped by number). Both count distinct things — an issue on
  three nodes is one issue. The board only knows node-linked issues, so `◆` is the *linked* open set.
- **Coverage — how well-MEASURED the tree is.** The yatsu **score circles**, counted through the very
  `ScoreBadge` the tiles render ([[yatsu-score-badge]]) — ONE vocabulary: green `✓` fresh pass, red `✗` fresh
  fail, a **stale** verdict as the **greyed mark inside the ring** (never an invented glyph), and a faint
  empty ring for a *blind spot* (declares scenarios, no current verdict). It counts only what the frontend
  can see — not a "should have a scenario" census, which lives in `spex yatsu scan`.

Every chip is a **walk**: clicking steps focus to the **next** node it counts, entering at the first when
focus is outside the ring and **wrapping** — so repeated clicks cycle through them all, each drilling that
node's spine open and panning to it. The step is the shared `cycleNext` primitive ([[keyboard-nav]]) the
`o`/`O` overlay cycle also walks with, so click and keypress advance alike. A **zero-count** chip dims and
goes inert. Desktop-only — it mounts in the graph shell the phone never renders ([[mobile-ui]]).

`BoardStats.jsx` is this node's only owned source: mounted by the shared App shell, **reusing** `cycleNext`
([[keyboard-nav]]) and `ScoreBadge` ([[yatsu-score-badge]]) rather than re-implementing them, and adding a
`.board-stats` block to the shared stylesheet ([[node-graph]] keeps `styles.css`) plus a `stats` i18n section
it owns. So a later change to the shell, the cycle primitive, or the graph is *their* node's drift, not this
strip's.
