---
title: evals-view
status: active
hue: 200
desc: The dashboard's Evals surface as GitHub-style TWO pages — a full-width LIST page (#/evals, [[side-nav]]) whose one-line rows are real anchors, and a standalone DETAIL page (#/evals/<node>/<scenario>) reached by a history PUSH so browser Back restores the exact filtered list. Un-merged worktree/session evals live in the SAME route family behind a default-off session filter (?session=<id>); the old #/sessions/…/eval address normalizes here. Both pages wear the shared [[review-chrome]].
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
- **The list's state is its URL.** Filters ride the hash's query string — `#/evals?kind=all&session=<id>`
  plus the live/ok chips — so a filtered list is copyable and Back-restorable: on every hashchange the
  list re-derives its WHOLE state from the URL, so Back replays exactly what was on screen. A human's
  filter change PUSHES (GitHub's semantics — Back walks filter history); only an AUTOMATIC rewrite (the
  legacy-address normalization) replaces. Rows are the
  [[evals-feed]] grammar: one
  line each, latest reading per scenario, and each row is a REAL `<a href>` to its detail address — the
  row's context menu, middle-click, and copy-link all work for free.
- **List → detail is a history PUSH; Back restores the list exactly.** Clicking a row (or Enter on the
  j/k cursor) navigates to the detail page as a normal hash push — measured on GitHub: history grows by
  one, and Back returns to the previous list URL with its query intact. The detail page renders standalone:
  a direct open or reload works with no list mounted, and there is NO fake in-app Back button — the
  browser's history is the return path. An address naming no real eval renders an honest not-found with a
  link to the list, never a silent rewrite to some other eval.
- **The detail page wears the shared [[review-chrome]] skeleton** (GitHub's issue-detail grammar): a
  header naming the scenario (title) and node, a status band (verdict badge + the A/B strip), then a MAIN
  column beside a metadata SIDE rail. The main column is the [[event-detail]] evidence WORKSPACE — media
  stage under the review-track scrubber, step rail, gallery/transcripts — followed by the (node, scenario)
  remark thread with its composer docked at the column's foot ([[event-detail]] owns that interior).
  The side rail is the reading/session metadata: evaluator, filed time, originator liveness, human-ok,
  staleness readout. On a phone-width viewport the SAME page reflows to one column with the side metadata
  ABOVE the workspace (GitHub's 390px order), never a shrunken two-column.
- **Un-merged session/worktree evals are the SAME pages behind a session filter.** A default-off session
  picker (the shared filter control) scopes the list to one session's WORKTREE-rooted model
  ([[session-eval]]'s `/api/sessions/:id/evals` — its gates strip shown, blind spots as non-navigable
  rows, in-session rows ✦-marked); the detail carries the same `?session=<id>` so its A/B history walks
  the worktree-rooted readings. `#/sessions/<id>/eval[/<node>/<scenario>]` is a LEGACY address: the route
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
