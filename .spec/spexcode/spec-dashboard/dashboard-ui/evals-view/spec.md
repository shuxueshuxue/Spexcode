---
title: evals-view
status: active
hue: 200
desc: The dashboard's Evals surface as GitHub-style TWO pages — a ListView query + Fail/Pass loss axis + secondary human-review/freshness/evidence builders over structured anchors, and a standalone evidence detail reached by PUSH; merged and worktree/session loss share this route family and [[review-chrome]].
code:
  - spec-dashboard/src/EvalsPage.jsx#EvalsPage
  - spec-dashboard/src/EvalsPage.jsx#EvalsListPage
  - spec-dashboard/src/EvalsPage.jsx#EvalDetailPage
  - spec-dashboard/src/EvalsPage.jsx#EvalScopeDoor
related:
  - spec-dashboard/test/evals-entry.e2e.mjs
  - spec-dashboard/src/i18n/zh.test.mjs
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
  rail entry, ⌥3/⌥F, and the board's bare `f` land on the list. The list uses [[review-chrome]]'s ONE
  25-row paged-review server contract for both trunk and `scope:` sources; it never slices the graph board
  or the scoped REST model in React.
- **The list's state is its URL — as ONE token query.** The whole face rides [[review-chrome]]'s visible
  query text (`is:eval` by default; the [[review-query]] engine) — verdict, freshness,
  evidence kind, node, filer, source-session presence, worktree scope, and human-review lifecycle
  are all tokens in it — so a filtered list is copyable and Back-restorable: the bare `#/evals` is the
  default view, anything else is exactly `?q=<raw text>`, and on every hashchange the list re-derives its
  WHOLE state from that text. A human's edit, tab, or menu pick PUSHES (GitHub's semantics — Back walks
  filter history); only an AUTOMATIC rewrite replaces — the legacy address shapes
  (`#/sessions/<id>/eval…` and the old structured `kind/verdict/freshness/node/filer/live/ok/session`
  params) normalize at the route layer into that token text, old links keep working, the old shape is
  never re-minted. Page is hash-query view state: every query/quick-filter/facet change resets by omitting
  page; pagination serializes page after `q`, including explicit `page=1` on a return to the first page;
  direct open/refresh/Back preserve that form. Rows are the
  [[evals-feed]] grammar: a shared structured row for each latest result per scenario, and each row is a
  REAL `<a href>` to its detail address — the
  row's context menu, middle-click, and copy-link all work for free.
- **Fail / Pass leads measured loss; review lifecycle does not.** The ListView's top quick-filter group
  renders Fail then Pass through the shared ReviewState icon/tone/count and toggles `verdict:` by token
  surgery + PUSH. The pair is intentionally non-exhaustive: with neither active, the default list still
  shows blind, unscored, and unknown verdict rows; their presence is never falsified to make a binary
  tab model fit. Counts are stable under every other token. `state:current|reviewed` remains visible in
  the query and in the secondary Human review builder (Needs review / Reviewed), with the same reload and
  Back replay, but no longer consumes the page's primary hierarchy. Issues keeps its natural Open/Closed
  lifecycle tabs; only the chrome/query/state primitives and geometry are shared.
- **List → detail is a history PUSH; Back restores the list exactly.** Clicking a row (or Enter on the
  j/k cursor) navigates to the detail page as a normal hash push — measured on GitHub: history grows by
  one, and Back returns to the previous list URL with its query intact. The detail page renders standalone:
  a direct open or reload works with no list mounted. Its chrome carries ONE compact **back anchor** — the
  shared [[review-chrome]] DetailShell left arrow, a REAL `<a href>` and never a `history.back` button:
  its destination derives ONLY from the detail's own canonical address through [[address-routing]]'s one
  back helper — a trunk detail returns to the bare `#/evals` list, a `scope:<id>` detail to its scoped
  DEFAULT list (the same one canonical address the session doors mint, `scope:` token kept) — so "back"
  always means the list on the detail's own data-source axis, and a pushed visit, a direct open, and a
  reload all share one destination, never guessed from a referrer, history state, or the originator's
  presence. A detail carries no terminal exit: its one small return arrow has one meaning, back to its
  canonical list. Browser Back keeps restoring the previous URL exactly (the anchor is an ordinary
  push, it replaces nothing). An address naming no real eval renders an honest not-found with a link to
  the list, never a silent rewrite to some other eval.
- **The detail page wears the shared [[review-chrome]] skeleton** (GitHub's issue-detail grammar): a
  header naming the scenario (title) and node, a status band (the ONE shared verdict visual + an A/B strip
  whose result buttons consume that same visual mapping), then a MAIN
  column beside a metadata SIDE rail. The main column is the [[event-detail]] evidence WORKSPACE — media
  stage under the review-track scrubber, step rail, gallery/transcripts — followed by the (node, scenario)
  remark thread with its composer docked at the column's foot ([[event-detail]] owns that interior).
  The side rail is the result/session metadata: evaluator, filed time, originator liveness, human-ok,
  staleness readout — then the **continue-reviewing queue**: the viewed result's NEIGHBORS in the source
  dataset's stable default order (the relative order the list renders; a filtered list
  face may hide rows the queue still walks), split into two POSITIONAL groups — **Previous** (entries
  before the current row) and **Up next** (entries after it), labels claiming list direction, never
  time — each ordered nearest-to-current outward. The default total is ~5, split balanced with the
  forward group taking the odd slot; at either boundary the short side's unused budget refills from the
  other side so the total holds while the dataset allows; the current result is excluded. A group with
  no entries renders no heading. This page computes the queue from the ONE
  source dataset it already holds — no second fetch, no ListPage or filter fork, no private selection
  state — and each entry is a REAL detail anchor wearing the shared verdict visual with its scenario and
  node ([[event-detail]] renders the rows): a trunk neighbor's href is the pure detail path, a scoped
  neighbor's keeps the same one `scope:` token. No neighbors → the section does not render at all. Issues
  details carry no queue. On a phone-width viewport the SAME page reflows to one column with the side
  metadata ABOVE the workspace (GitHub's 390px order), never a shrunken two-column.
- **Un-merged session/worktree evals are the SAME pages behind the `scope:` token.** `scope:<id>` in the
  query text — hand-typed, completed from the input's autocomplete (candidates: sessions on the current
  board only), or minted by the session doors as the scoped default view (the console tab bar's and the
  phone session header's eval doors are REAL ANCHORS whose href IS that canonical address, projected by
  [[address-routing]] — one ordinary hash push straight to the final address, never a JS-only button,
  never the legacy `?session` param) — sources the list from one session's WORKTREE-rooted model
  ([[session-eval]]'s `/api/sessions/:id/evals` — its gates strip shown, blind spots as non-navigable
  rows, in-session rows ✦-marked). That backend model is already bounded to scenarios whose own code or
  semantic contract this worktree affected, plus scenarios this session measured; the page never repeats
  the impact predicate. An affected declared scenario without a reading remains a blind/unmeasured row and
  an affected stale reading remains navigable. Changed frontend files with no declared scenario are
  node-level unknown coverage in the leading strip, never synthetic rows and never part of scenario/filter
  counts. The detail carries only `?q=scope:<id>` (never list filters) so its
  A/B history walks the worktree-rooted results. Every scoped detail face returns to the SAME list:
  the happy detail's back arrow and the failure/not-found faces' list link all point at the SCOPED
  default view — the door-minted address — keeping the user on the data-source axis their address named
  (no detail face carries a terminal door).
  The scoped LIST alone carries the restrained **terminal DOOR** — the ONE EvalScopeDoor primitive,
  icon-only and never a visible banner: it is the gates toolbar's LEFTMOST item and first focusable
  control, before lint/merge/ahead/committed and export, so the visual and keyboard hierarchy reads
  "back to the session" before the list's local controls at desktop and phone width. The gates strip is a
  leading child inside the SAME [[page-scroll]] as the list, never a sibling that moves the scrollbar
  track below the shared inset. The door is a REAL
  anchor to `#/sessions/<id>`, the terminal console, wearing the left-arrow back glyph on a stable 32px hit
  target. Its tooltip and aria-label use the same short localized imperative without a dynamic id:
  `Back to session terminal` / `返回会话终端`. It derives ONLY from the canonical address, so a
  door-entry visit, a direct open, and a reload wear the identical list door; trunk faces and every
  detail face wear none. The return hierarchy stays separate by construction: the list door is the one
  way to the terminal, the detail's ds-back is the list on the detail's own axis (the scoped default
  view for a scoped detail — byte-identical to the door-minted address; the bare `#/evals` for a trunk
  one), and browser Back walks the real history (a scoped list→detail push returns exactly to the scoped
  list URL) — never blended, never guessed from history.back or a referrer. Scope is the DATA
  SOURCE axis and is never conflated with `session:present|missing`, the source-session presence facet.
  A dead or unknown scope id keeps its token and shows the honest empty/error face — the text itself is
  the off-switch.
  `#/sessions/<id>/eval[/<node>/<scenario>]` is a LEGACY address: the route
  layer normalizes it (replace) to the `#/evals` form — old links keep working, the old shape is never
  re-minted, and the console exposes only a door that navigates here. The session model has three honest
  read states: loading, loaded/not-found, and failed. A failed fetch is never rendered as an empty session
  or a missing eval: the list keeps its scope/filter controls mounted beside an explicit error, while a
  detail gets a distinct load-failed face; only a successfully loaded model without the addressed result
  gets the not-found face.
- **One data protocol over two source roots.** The project list and scoped list request the same
  paged-review endpoint/shape; the backend projects the current graph/eval aggregate for trunk and the
  worktree-rooted session-eval model for `scope:` before filtering/count/slice. The browser never receives
  the graph's full eval board or a full scoped model merely to hide all but one page. Detail may fetch the
  one addressed reading plus its bounded neighbor queue; it does not reconstruct the full list. A remark
  or /ok written from the detail refreshes its source revision — writes, dispatch echo ([[mentions]]), and evidence behavior are
  unchanged. The session detail's worktree history is referentially stable while its scope, node, scenario,
  and viewed result are unchanged: an unrelated board poll/SSE repaint cannot reset the selected A/B pole,
  loaded timeline events, ordinary typed prose, or anchored composer draft. A real
  scope/scenario/A-B-result change re-sources the workspace and clears that draft before the new result is
  reviewable.
