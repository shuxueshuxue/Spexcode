---
title: evals-feed
status: active
hue: 200
desc: The Evals ListView rows and filters through [[review-chrome]] — latest result per scenario, structured state/title/filer/time/kind rows, Fail/Pass verdict quick filters, secondary human-review/freshness/evidence/presence builders, and token-only node/filer/scope over ONE visible query; media stays strictly lazy.
code:
  - spec-dashboard/src/EvalsFeed.jsx#EvalsGroup
related:
  - spec-eval/src/evaltab.ts
  - spec-cli/src/graph.ts
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/reviewFilters.js
---
# evals-feed

## raw source

The Evals list page ([[evals-view]]) is where a human reads the project's current measured loss — the
leading review surface. A feed of every result ever filed grows without bound; a feed of the project's
*current* loss does not. The unit is the **scenario, not the result**: the eval engine already defines
the latest result per scenario as the current score, so the list is bounded by declared scenarios
(structural, slow-growing), never by measurement count — which is also why it needs no pagination. Review
attends to what still counts; and in the GitHub navigation model each row is a LINK to the eval's own
page, not a selection in a pane.

## expanded spec

Default view: **latest result per scenario, newest first — fresh and stale, reviewed and unreviewed,
scored and blind mixed honestly**. A stale result is real measured loss and remains visible; freshness is
an honest facet, never a default hide. The leading quick-filter axis is **Fail / Pass**: each action wears
the ONE [[review-chrome]] ReviewState icon + tone + count and surgically toggles `verdict:fail|pass` in the
visible query. It is deliberately a named pressed-button group, not a tablist: verdict is not exhaustive,
so the default `is:eval` list may show blind, unscored, or unknown rows while neither button is pressed.
Counts are computed under the rest of the query, excluding the active verdict token, and a second click
clears it back to the honest whole list. A fresh human-ok'd result is `state:reviewed`; everything else is
`state:current`. That lifecycle remains transparent in the query and editable through the secondary
**Human review** builder (Needs review / Reviewed), but no longer occupies the top visual hierarchy.
When the worktree scope contributes its terminal/gates strip, the feed hands it to ListPage as leading
content inside the shared [[page-scroll]]; it never wraps the list with a second shell or moves the track.
Every filter is a token in [[review-chrome]]'s ONE visible query ([[review-query]]),
and matching travels through [[review-filters]]'s Eval adapter — page code only bridges the parsed text
into the shared engine, so the embedded node list cannot acquire different parsing or matching semantics:
`verdict:`, `freshness:`, and `evidence:` (values exactly video | image | all; the default is `all`,
with NO data-dependent fallback) keep low-cardinality menus that are pure query builders; the
source-session presence facet is `session:present|missing` ([[live-session-filter]]); `node:` and
`filer:` are HIGH-cardinality token-only dimensions — hand-typed or completed from the input's bounded
autocomplete, never an enumerating dropdown — and `scope:` sources the worktree model ([[evals-view]]).
Bare words search scenario/node/filer/evaluator; an unknown qualifier matches nothing, honestly. Common
menus stay visible on desktop, low-frequency/width-displaced ones move
to the functional overflow, and only the primary facet survives beside the tabs at 390px. **Every pick is
URL-query state**: a human's action pushes `?q=<raw text>` (the default view stays bare), reload/Back
fully replay, and no local filter state survives. If live data contracts, an active menu value keeps its
All off-switch — and the visible text is always the canonical release, whatever state the scope is in.
An inert blind-spot row participates in that SAME conjunctive contract: it can match its real node,
unscored verdict, and query text, but a selected Fail/Pass quick filter, evidence kind, freshness, filer,
or source-session presence value excludes it
because an unmeasured scenario owns none of those result facts. Blind rows never leak into a filtered
result population and never gain an href just to satisfy list structure. Filed results and non-result
rows form one tagged set through the shared result-kind field; the canonical list and embedded node pane
consume that same discriminator, with no legacy-name compatibility branch.

**Kinds are honest — and a result carries a SET of them.** Evidence is a LIST: a result's kinds are
every entry it holds (`video`/`image`/`transcript`; a legacy scalar blob with no kind is an image), plus
**`note`** when it holds no blob. A MIXED result belongs to EVERY media filter it contains and its tag
lists its kinds video-first (`vid·img`); it never advertises media it lacks. `note` and `transcript` are
data-level kinds only, never filter options — they surface under `all`.

**Rows use the shared two-level primitive, and each row is a REAL `<a>`** to
`#/evals/<node>/<scenario>` (the worktree scope's rows carry `?q=scope:<id>` and nothing else) — shared verdict visual +
wrapping scenario title; node, filer, and filed time below; evidence kind/scope at the right (joining the
secondary line at 390px). No media request of any kind occurs in the list, no per-row write affordance
(reviewing + signing lives on the detail page). A human-ok'd row adds the one settled certification mark
(the shared stroke check in a quiet green ring, signer/time as its accessible name). Clicking a row is a
history PUSH onto the detail page; `j`/`k` move the cursor and Enter opens it ([[review-chrome]]).

**One data path, one computation.** The project scope's nodes arrive as a prop from the app's single
board poll + SSE — the list fetches nothing of its own — and latest-per-scenario is `scenarioStates`, the
same computation behind the node badge, graph stats, search, and the node eval tab; the feed never re-derives
the current score its own way. The `scope:<id>` token rides the one session model the page fetches
([[evals-view]] / [[session-eval]]) through the SAME row grammar — ✦ marking the in-session rows, blind
spots as inert unmeasured lines. The session model arrives already scenario-scoped by its backend impact
engine, so list rows and every filter count naturally range over only the worktree's affected/measured
scenarios; unknown coverage stays in the scoped leading strip and cannot enter the result adapter. Loading,
empty, and failed models do not replace the list shell: the scope
and kind controls stay mounted, with the appropriate empty note or explicit error beneath them.
