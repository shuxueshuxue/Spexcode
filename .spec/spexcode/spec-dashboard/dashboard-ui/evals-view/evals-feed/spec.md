---
title: evals-feed
status: active
hue: 200
desc: The Evals LIST page's rows and filters ([[evals-view]], rendered through [[review-chrome]]'s ListPage) — the project's current measured loss: latest reading per scenario, fresh AND stale mixed newest-first (freshness is never a filter); each row ONE line and a REAL anchor to its detail address; the kind dropdown (video | image | all) and the live/ok chips as URL-query state, the shared control grammar the issues list wears; media strictly lazy.
code:
  - spec-dashboard/src/EvalsFeed.jsx#EvalsGroup
related:
  - spec-eval/src/evaltab.ts
  - spec-cli/src/graph.ts
  - spec-dashboard/src/App.jsx
---
# evals-feed

## raw source

The Evals list page ([[evals-view]]) is where a human reads the project's current measured loss — the
leading review surface. A feed of every reading ever filed grows without bound; a feed of the project's
*current* loss does not. The unit is the **scenario, not the reading**: the eval engine already defines
the latest reading per scenario as the current score, so the list is bounded by declared scenarios
(structural, slow-growing), never by measurement count — which is also why it needs no pagination. Review
attends to what still counts; and in the GitHub navigation model each row is a LINK to the eval's own
page, not a selection in a pane.

## expanded spec

Default view: **latest reading per scenario, newest first — fresh and stale MIXED, always**. Freshness is
**never a filter**: a stale reading is real measured loss and stays in the time-ordered list, its muted
✓/✗ the only stale signal — hiding it was the bug that let a just-filed screenshot vanish, and the head
carries **no stale control at all**. The ONE dropdown filter is the **evidence-kind pick** — exactly
video | image | all, the SAME shared `FilterSelect` the [[issues-view]] store filter uses — defaulting to
`video`, falling back to `image` then `all` when the data lacks the richer kind. The chip row carries the
[[live-session-filter]] "N live" toggle (readings whose filer session is alive — the same one-judgment
join the filer chip renders) and the [[human-ok]] reveal chip (a fresh, ok'd scenario is reviewed loss —
the ONE default hide — released by the chip; both chips self-hide at N=0 only while OFF, so a filter is
always releasable and the list never dead-ends). **Every filter is URL-query state** ([[evals-view]]):
a human's pick pushes a new list address, and the list re-derives all of it from the URL on each
hashchange — no component-local filter state survives that the address doesn't name.

**Kinds are honest — and a reading carries a SET of them.** Evidence is a LIST: a reading's kinds are
every entry it holds (`video`/`image`/`transcript`; a legacy scalar blob with no kind is an image), plus
**`note`** when it holds no blob. A MIXED reading belongs to EVERY media filter it contains and its tag
lists its kinds video-first (`vid·img`); it never advertises media it lacks. `note` and `transcript` are
data-level kinds only, never filter options — they surface under `all`.

**Rows are one line, and each row is a REAL `<a>`** to `#/evals/<node>/<scenario>` (the session scope's
rows carry the `?session=<id>` query) — verdict mark · scenario · node · kind tag · relative time, the
[[review-chrome]] row rhythm; no media request of any kind in the list, no per-row write affordance
(reviewing + signing lives on the detail page). A human-ok'd row adds the one settled certification mark
(the shared stroke check in a quiet green ring, signer/time as its accessible name). Clicking a row is a
history PUSH onto the detail page; `j`/`k` move the cursor and Enter opens it ([[review-chrome]]).

**One data path, one computation.** The project scope's nodes arrive as a prop from the app's single
board poll + SSE — the list fetches nothing of its own — and latest-per-scenario is `scenarioStates`, the
same computation behind the node badge, the focus panel, and the node eval tab; the feed never re-derives
the current score its own way. The `?session=<id>` scope rides the one session model the page fetches
([[evals-view]] / [[session-eval]]) through the SAME row grammar — ✦ marking the in-session rows, blind
spots as inert unmeasured lines. Loading, empty, and failed models do not replace the list shell: the scope
and kind controls stay mounted, with the appropriate empty note or explicit error beneath them.
