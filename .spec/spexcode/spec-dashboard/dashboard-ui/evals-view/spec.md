---
title: evals-view
status: active
hue: 200
desc: The dashboard's Evals surface as GitHub-style TWO pages — a ListView query + Current/Reviewed sections + real eval facets over structured anchors, and a standalone evidence detail reached by PUSH; merged and worktree/session loss share this route family and [[review-chrome]].
code:
  - spec-dashboard/src/EvalsPage.jsx#EvalsPage
  - spec-dashboard/src/EvalsPage.jsx#EvalsListPage
  - spec-dashboard/src/EvalsPage.jsx#EvalDetailPage
---

# evals-view

## raw source

The project's measured loss deserves a surface of its own, and the human's directive names the navigation
model to copy: **GitHub's issues**, verified against the live product — the list is one page whose whole
state (filters, query) lives in the URL, each row is a plain copyable link, clicking a row PUSHES a history
entry onto a standalone full-page detail, and browser Back restores the exact filtered list URL (GitHub's
own docs promise the URL↔view equivalence). No master-detail split pane, no in-page selection echo: **list
page and detail page are two different addresses.** GitLab's default side-panel mode was explicitly NOT
chosen — this is the full-page mode. And the second directive: un-merged worktree evals stop living under
`#/sessions/<id>/eval` — one route family, `#/evals`, carries merged and un-merged loss alike, a session
filter (default off) picking the root.

## expanded spec

- **Two pages, one route family.** `#/evals` is the LIST page; `#/evals/<node>/<scenario>` is the DETAIL
  page — each bookmarkable, reloadable, directly openable (hash routing needs no server). The [[side-nav]]
  rail entry, ⌥3/⌥F, and the board's bare `f` land on the list. There is no pagination — the list is
  bounded by declared scenarios and the API has no page semantics, so none is invented.
- **The list's state is its URL — as ONE token query.** The whole face rides [[review-chrome]]'s visible
  query text (`is:eval state:current` by default; the [[review-query]] engine) — verdict, freshness,
  evidence kind, node, filer, source-session presence, worktree scope, and the Current/Reviewed section
  are all tokens in it — so a filtered list is copyable and Back-restorable: the bare `#/evals` is the
  default view, anything else is exactly `?q=<raw text>`, and on every hashchange the list re-derives its
  WHOLE state from that text. A human's edit, tab, or menu pick PUSHES (GitHub's semantics — Back walks
  filter history); only an AUTOMATIC rewrite replaces — the legacy address shapes
  (`#/sessions/<id>/eval…` and the old structured `kind/verdict/freshness/node/filer/live/ok/session`
  params) normalize at the route layer into that token text, old links keep working, the old shape is
  never re-minted. Rows are the
  [[evals-feed]] grammar: a shared structured row for each latest reading per scenario, and each row is a
  REAL `<a href>` to its detail address — the
  row's context menu, middle-click, and copy-link all work for free.
- **List → detail is a history PUSH; Back restores the list exactly.** Clicking a row (or Enter on the
  j/k cursor) navigates to the detail page as a normal hash push — measured on GitHub: history grows by
  one, and Back returns to the previous list URL with its query intact. The detail page renders standalone:
  a direct open or reload works with no list mounted. Its chrome carries ONE compact **back anchor** — the
  shared [[review-chrome]] DetailShell left arrow, a REAL `<a href>` and never a `history.back` button:
  the destination derives ONLY from the detail's own canonical address ([[address-routing]]'s one back
  helper) — `#/evals` for a trunk-rooted detail, and for a detail whose canonical query carries
  `scope:<id>` the scope session's terminal console `#/sessions/<id>` — so a pushed visit, a direct open,
  and a reload all share one destination, never guessed from a referrer, history state, or the
  originator's presence. Browser Back keeps restoring the previous URL exactly (the anchor is an ordinary
  push, it replaces nothing). An address naming no real eval renders an honest not-found with a link to
  the list, never a silent rewrite to some other eval.
- **The detail page wears the shared [[review-chrome]] skeleton** (GitHub's issue-detail grammar): a
  header naming the scenario (title) and node, a status band (the ONE shared verdict visual + an A/B strip
  whose reading buttons consume that same visual mapping), then a MAIN
  column beside a metadata SIDE rail. The main column is the [[event-detail]] evidence WORKSPACE — media
  stage under the review-track scrubber, step rail, gallery/transcripts — followed by the (node, scenario)
  remark thread with its composer docked at the column's foot ([[event-detail]] owns that interior).
  The side rail is the reading/session metadata: evaluator, filed time, originator liveness, human-ok,
  staleness readout. On a phone-width viewport the SAME page reflows to one column with the side metadata
  ABOVE the workspace (GitHub's 390px order), never a shrunken two-column.
- **Un-merged session/worktree evals are the SAME pages behind the `scope:` token.** `scope:<id>` in the
  query text — hand-typed, completed from the input's autocomplete (candidates: sessions on the current
  board only), or minted by the session doors as the scoped default view — sources the list from one
  session's WORKTREE-rooted model
  ([[session-eval]]'s `/api/sessions/:id/evals` — its gates strip shown, blind spots as non-navigable
  rows, in-session rows ✦-marked); the detail carries only `?q=scope:<id>` (never list filters) so its
  A/B history walks the worktree-rooted readings, while its way BACK to the list is the scoped default
  view — the same text every door mints. Scope is the DATA SOURCE axis and is never conflated
  with `session:present|missing`, the source-session presence facet. A dead or unknown scope id keeps
  its token and shows the honest empty/error face — the text itself is the off-switch.
  `#/sessions/<id>/eval[/<node>/<scenario>]` is a LEGACY address: the route
  layer normalizes it (replace) to the `#/evals` form — old links keep working, the old shape is never
  re-minted, and the console exposes only a door that navigates here. The session model has three honest
  read states: loading, loaded/not-found, and failed. A failed fetch is never rendered as an empty session
  or a missing eval: the list keeps its scope/filter controls mounted beside an explicit error, while a
  detail gets a distinct load-failed face; only a successfully loaded model without the addressed reading
  gets the not-found face.
- **One data path.** The project list rides the app's one board poll + SSE as a prop and fetches nothing;
  the session mode fetches the one session model. A remark or /ok written from the detail refreshes its
  source (board or session model) — writes, dispatch echo ([[mentions]]), and evidence behavior are
  unchanged. The session detail's worktree history is referentially stable while its scope, node, scenario,
  and viewed reading are unchanged: an unrelated board poll/SSE repaint cannot reset the selected A/B pole,
  loaded timeline events, ordinary typed prose, or anchored composer draft. A real
  scope/scenario/A-B-reading change re-sources the workspace and clears that draft before the new reading is
  reviewable.
