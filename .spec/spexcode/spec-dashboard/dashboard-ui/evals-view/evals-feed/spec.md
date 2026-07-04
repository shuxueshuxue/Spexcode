---
title: evals-feed
status: active
hue: 200
desc: The Evals page's feed — the project's current measured loss as a feed, the left list of the master-detail ([[evals-view]]). Latest reading per scenario, fresh AND stale mixed newest-first (freshness is never a default hide — the stale chip is an opt-in narrowing); title-only rows, media strictly lazy.
code:
  - spec-dashboard/src/EvalsFeed.jsx
related:
  - spec-yatsu/src/evaltab.ts
  - spec-cli/src/board.ts
  - spec-dashboard/src/App.jsx
---
# evals-feed

## raw source

The Evals page ([[evals-view]]) is where a human reads the project's current measured loss — the leading
review surface, a top-level page of its own (evals outrank issues, so they get the leading page and the
`f` / ⌥F doors). This feed is its left list, and its outer container never scrolls — the list scrolls
internally. A feed of every reading ever filed grows without bound; a feed of the project's *current* loss
does not. The unit of this feed is the **scenario, not the reading**: yatsu already defines the latest
reading per scenario as the current score, so the feed is bounded by declared scenarios (structural,
slow-growing), never by measurement count. Review attends to what still counts.

## expanded spec

Default view: **latest reading per scenario, newest first — fresh and stale MIXED**. Freshness is **never a
default hide**: a stale reading is real measured loss and stays in the time-ordered feed, its row carrying the
muted ✓/✗ that marks it stale (so it reads *as* stale without being removed) — hiding it was the bug that let
a just-filed screenshot vanish behind a chip while newer work looked absent. The evidence-kind filter defaults
to `video`, falling back to `image` when no reading *contains* a video and to `all` when neither media kind is
present. The **stale chip is the INVERSE of a hide** — an opt-in narrowing: off shows everything; on shows
*only* stale readings (drill into the outstanding drift), and it carries the live stale count. The chips
(video | image | note | all, the stale toggle) live in this group's sticky head and are this group's own
state — [[evals-view]] owns the page shell (split, selection, j/k), never this group's filters.

**Kinds are honest — and a reading now carries a SET of them.** Evidence is a LIST, so a reading's kinds are
every entry it holds: `video`/`image`/`transcript` (a legacy scalar blob with no recorded kind is an image —
every legacy capture was one), and **`note`** when it holds no blob at all (a verdict filed with prose only). A
**MIXED** reading (images + a video) belongs to **EVERY** kind-filter it contains — it shows under both the
`video` and `image` chips — and its row tag lists the full set, video-first (e.g. `vid·img`). A reading never
advertises media it lacks: a blob-less reading is a `note`, claimed by no media filter, the `note` chip and
tag its own.

**Rows are title-only, always** — verdict mark · scenario · node · evidence-kind tag · relative time —
no media request of any kind in the list. Selecting a row opens it in the page's DETAIL pane as the
[[event-detail]] — media loads there, a `<video>` element exists only there. The group reports its visible
rows upward so the page's j/k walk the feed; history drills down per scenario
(the node's [[yatsu-eval-tab]] scaffold), not in the list.

**One data path, one computation.** The board nodes arrive as a prop from the app's single board
poll + SSE subscription — the section fetches nothing of its own — and latest-per-scenario is
`scenarioStates`, the same computation behind the node badge, the focus panel, and the eval tab; the feed
never re-derives the current score its own way. At scale the board fold itself converges to the same
semantics — latest reading per scenario plus a history count, the full timeline served per node on
demand — one convergence shared by this feed, the node eval tab, and [[board-lean]];
`clean --keep-latest` already aligns the evidence bytes with it.
