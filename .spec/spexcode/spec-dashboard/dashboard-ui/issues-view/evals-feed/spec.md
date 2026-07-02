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
badge, expanded on demand. Filter chips (video | image | all) and the fresh/stale toggle are section
state that survives the section's density switches — the section furniture (densities, pinning, keys) is
[[issues-view]]'s contract, not this node's.

**Rows are title-only at rest** — verdict mark · scenario · node · evidence-kind icon · relative time — no
media request of any kind. Expanding a row pulls its thumbnail and the scenario's `expected`; opening it
launches the [[annotator]] — a `<video>` element exists only there, never in the feed. The list is
virtualized; history drills down per scenario (the node's [[yatsu-eval-tab]] scaffold), not inline.

Until [[issues-view]]'s two-region skeleton lands, the feed mounts provisionally from a hud ▶ button as
its own overlay (Esc closing via the shared stack); it moves into the issues view's upper region — and the
button hands over to that surface's entries — the moment the skeleton arrives.

Data rides the board's existing evals fold. At scale the fold itself converges to the same semantics —
latest reading per scenario plus a history count, the full timeline served per node on demand — one
convergence shared by this feed, the node eval tab, and [[board-lean]]; `clean --keep-latest` already
aligns the evidence bytes with it.
