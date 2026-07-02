---
title: evals-feed
status: active
hue: 200
desc: The issues view's evals section — the project's current measured loss as a feed, leading above the issues. Latest reading per scenario, fresh first, video first; title-only rows, media strictly lazy.
code:
  - spec-dashboard/src/EvalsFeed.jsx
related:
  - spec-yatsu/src/evaltab.ts
  - spec-cli/src/board.ts
  - spec-dashboard/src/App.jsx
---
# evals-feed

## raw source

The issues view ([[issues-view]]) is where a human reviews the project, and evals outrank the issues
there: the freshest measurements lead, **above** the discussion, with the issues section pinned below (never pushed
off-screen — the surface's outer container never scrolls; each section scrolls internally). A feed of
every reading ever filed grows without bound; a feed of the project's *current* loss does not. The unit of
this feed is the **scenario, not the reading**: yatsu already defines the latest reading per scenario as
the current score, so the feed is bounded by declared scenarios (structural, slow-growing), never by
measurement count. Review attends to what still counts.

## expanded spec

Default view: **latest reading per scenario, fresh only, newest first**, evidence-kind filter defaulting
to `video` and falling back to `image` when no video reading exists; stale readings collapse to a count
badge, expanded on demand. The chips (video | image | all, the stale toggle) live in this group's sticky
head and are this group's own state — [[issues-view]] owns the page shell (split, selection, j/k), never
this group's filters.

**Rows are title-only, always** — verdict mark · scenario · node · evidence-kind icon · relative time —
no media request of any kind in the list. Selecting a row opens it in the page's DETAIL pane as the
[[annotator]] — media loads there, a `<video>` element exists only there. The group reports its visible
rows upward so the page's j/k walk one flat list across both groups; history drills down per scenario
(the node's [[yatsu-eval-tab]] scaffold), not in the list.

**One data path, one computation.** The board nodes arrive as a prop from the app's single board
poll + SSE subscription — the section fetches nothing of its own — and latest-per-scenario is
`scenarioStates`, the same computation behind the node badge, the focus panel, and the eval tab; the feed
never re-derives the current score its own way. At scale the board fold itself converges to the same
semantics — latest reading per scenario plus a history count, the full timeline served per node on
demand — one convergence shared by this feed, the node eval tab, and [[board-lean]];
`clean --keep-latest` already aligns the evidence bytes with it.
