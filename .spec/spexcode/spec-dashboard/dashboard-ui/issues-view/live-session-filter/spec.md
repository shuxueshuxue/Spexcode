---
title: live-session-filter
status: active
hue: 200
desc: One real Live facet in both review ListViews — Issues and Evals narrow to entries a live session is behind, reusing session.js liveSession and staying releasable even when the selected result falls to zero.
code:
  - spec-dashboard/src/session.js#liveSession
related:
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/EvalsFeed.jsx
  - spec-dashboard/src/Thread.jsx
---

# live-session-filter

## raw source

A reviewer triaging the drain often wants the subset an agent is still BEHIND — an issue whose
originating session is alive can still be steered or asked, while an orphaned one is archaeology. The
human asked for a small chip that narrows the issues list — and, as the same feature's second surface,
the evals feed — to exactly those entries, using the aliveness the originator chip already shows.

## expanded spec

- **One facet, two surfaces, one judgment.** Both [[issues-view]] and [[evals-feed]] expose Live through
  [[review-chrome]]'s shared real-data facet/overflow mechanism. Picking Live writes `?live=1` as a history
  PUSH; All clears it. The facet is omitted while nothing is live and it is off, but remains mounted and
  releasable when an active filter's result later falls to zero. A filter must never hide its own off-switch.
- **Live means: a session behind the entry is still alive.** For an issue, that is its originator
  (`issue.by`) or any reply author; for a reading, its filer (`by`). Aliveness is the ONE join the
  originator chip already renders — `session.js`'s `liveSession` (listed on the board and not offline,
  [[state]]'s zones) — so the chip-filtered list and the detail's liveness dots can never disagree; this
  node owns that shared helper, and no surface grows a second aliveness judgment. A non-session author
  ('human', a github login) is honestly not live.
- **Composition is honest.** Live combines with query, section, and other facets over the same row model;
  it is not a global stat or a second list. At 390px it remains available through the functional kebab.
