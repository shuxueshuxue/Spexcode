---
title: evals-feed
status: active
hue: 200
desc: The Evals ListView rows and facets through [[review-chrome]] — latest reading per scenario, structured state/title/filer/time/kind rows, Current/Reviewed sections, and real verdict/freshness/kind/node/filer/scope query facets; media stays strictly lazy.
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

Default view: **latest reading per scenario, newest first — fresh and stale mixed**. A stale reading is
real measured loss and remains in the default Current section; freshness is now an honest facet, never a
default hide. A fresh human-ok'd reading belongs to the Reviewed section while everything else belongs to
Current, preserving the existing default attention boundary as GitHub-style mutually exclusive tabs with
counts. The query field and verdict, freshness, evidence-kind, node, filer/live, and session-scope facets
all filter real entry fields; the kind values remain exactly video | image | all and keep the existing
video→image→all default. Common facets stay visible on desktop, low-frequency/width-displaced facets move
to the functional overflow, and only the primary facet survives beside the tabs at 390px. **Every pick is
URL-query state**: a human's action pushes, reload/Back fully replay, and no local filter state survives.
If live data contracts, an active facet keeps its All off-switch. Even a missing session id under
failed/loading/404 scope remains clearable in-page.
An inert blind-spot row participates in that SAME conjunctive contract: it can match its real node,
unscored verdict, and query text, but a selected evidence kind, freshness, filer, or Live facet excludes it
because an unmeasured scenario owns none of those reading facts. Blind rows never leak into a filtered
reading population and never gain an href just to satisfy list structure.

**Kinds are honest — and a reading carries a SET of them.** Evidence is a LIST: a reading's kinds are
every entry it holds (`video`/`image`/`transcript`; a legacy scalar blob with no kind is an image), plus
**`note`** when it holds no blob. A MIXED reading belongs to EVERY media filter it contains and its tag
lists its kinds video-first (`vid·img`); it never advertises media it lacks. `note` and `transcript` are
data-level kinds only, never filter options — they surface under `all`.

**Rows use the shared two-level primitive, and each row is a REAL `<a>`** to
`#/evals/<node>/<scenario>` (the session scope's rows carry `?session=<id>`) — shared verdict visual +
wrapping scenario title; node, filer, and filed time below; evidence kind/scope at the right (joining the
secondary line at 390px). No media request of any kind occurs in the list, no per-row write affordance
(reviewing + signing lives on the detail page). A human-ok'd row adds the one settled certification mark
(the shared stroke check in a quiet green ring, signer/time as its accessible name). Clicking a row is a
history PUSH onto the detail page; `j`/`k` move the cursor and Enter opens it ([[review-chrome]]).

**One data path, one computation.** The project scope's nodes arrive as a prop from the app's single
board poll + SSE — the list fetches nothing of its own — and latest-per-scenario is `scenarioStates`, the
same computation behind the node badge, graph stats, search, and the node eval tab; the feed never re-derives
the current score its own way. The `?session=<id>` scope rides the one session model the page fetches
([[evals-view]] / [[session-eval]]) through the SAME row grammar — ✦ marking the in-session rows, blind
spots as inert unmeasured lines. Loading, empty, and failed models do not replace the list shell: the scope
and kind controls stay mounted, with the appropriate empty note or explicit error beneath them.
