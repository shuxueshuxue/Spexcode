---
title: live-session-filter
status: active
hue: 200
desc: The source-session PRESENCE facet in both review ListViews — session:present|missing narrows Issues and Evals by whether the session behind an entry still exists on the board; one membership join, no liveness wording.
code:
  - spec-dashboard/src/session.js#sessionPresent
related:
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/EvalsFeed.jsx
  - spec-dashboard/src/reviewFilters.js
  - spec-dashboard/src/Thread.jsx
---

# live-session-filter

## raw source

A reviewer triaging the drain often wants to split entries by whether an agent's session is still AROUND
to steer or ask — an orphaned issue or reading is archaeology. The first cut filtered on liveness
(online/offline zones), which wobbled with transport state; the human converged it on the stable
question: does the source session still EXIST on the board?

## expanded spec

- **One facet, two surfaces, one token.** Both [[issues-view]] and [[evals-feed]] expose it through
  [[review-chrome]]'s low-cardinality menu mechanism as the `session:present|missing` token — UI wording
  "Source session / Present / Missing" (中文「来源会话 / 仍在 / 已不在」). The words live/online/offline
  never appear on this facet: it asks presence, not connectivity. Picking a value is token surgery + a
  history PUSH; All removes the token. Options are data-derived through the [[review-filters]] adapter:
  a one-sided dataset hides the INACTIVE menu (no fake control), but an ACTIVE value is always a real
  CHECKED row with All releasable even at zero results — an active facet never hides its own
  off-switch, and the visible text remains a second, canonical release.
- **Present means: the source session still resolves on the current board — any zone.** For an issue,
  the source is its originator (`issue.by`) or any reply author; for a reading, its filer (`by`). The
  judgment is the ONE membership join this node owns — `session.js`'s `sessionPresent` — so no surface
  grows a second one. A non-session author ('human', a github login) is honestly missing. `missing` is
  the complement, so the pair partitions every entry.
- **Never conflated with scope.** `scope:<id>` picks the worktree DATA SOURCE ([[evals-view]]);
  `session:` only classifies entries by their source session's presence. A session id is never a legal
  `session:` value — an id typed there simply matches nothing, honestly.
- **Composition is honest.** Presence combines conjunctively with the query's other tokens over the same
  row model; it is not a global stat or a second list. At 390px it remains available through the
  functional kebab.
