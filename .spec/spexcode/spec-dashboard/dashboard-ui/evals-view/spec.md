---
title: evals-view
status: active
hue: 200
desc: The dashboard's Evals page — a top-level route (#/evals, [[side-nav]]) peer to the graph, the session board, and the Issues page, showing the project's current measured loss as a MASTER-DETAIL: the [[evals-feed]] list in a SLIM, foldable left column, the [[event-detail]] workspace of the selection full-height on the right. Evals lead — the board's `f` and ⌥F land here.
code:
  - spec-dashboard/src/EvalsPage.jsx
---

# evals-view

## raw source

The project's measured loss is what the optimizer reads, so a human reviewing the project wants it on a
surface of its own — not buried as a tab inside another page. Evals and issues were once one `#/issues`
page with an in-page `Evals | Threads` switcher; the human's directive collapsed the indirection: make
them **two top-level pages**, peers of the graph and the session board. So the evals get their OWN page,
`#/evals`, a real [[side-nav]] rail entry and route — and because the current loss is what review attends
to first, **evals lead**: they sit above issues in the rail, and the board's shortcuts to the review
surfaces (`f`, ⌥F) land here.

## expanded spec

- **A top-level page, not a tab.** `#/evals` is a peer route with its own [[side-nav]] rail entry —
  bookmarkable, reloadable, history-walked. The keyboard doors are [[side-nav]]'s global ⌥ vocabulary
  (**⌥3** in rail order, plus **⌥F** — evals are the leading loss surface) reachable from any page, and the
  board's bare **`f`** ([[side-nav]] / the keymap) as the direct jump from the graph. There is no in-page
  switcher: the page IS the evals, the [[issues-view]] page IS the issues, and the rail is how you cross
  between them.
- **The selection has an ADDRESS — `#/evals/<node>/<scenario>` is the canonical eval URL.** An eval a
  human wants another human (or a dispatched agent) to look at must be pointable-at: the deep link selects
  exactly that (node, scenario) in the detail pane — widening the feed's default kind filter when it would
  hide the target ([[evals-feed]]'s `mustShow`, the feed widening its own state) — and every selection made
  in the page (a row click, a j/k hop) is ECHOED back into the hash with replace ([[side-nav]]'s
  pages-push/details-replace discipline), so the address bar always names the eval on screen and copy-URL
  is the share affordance, no button needed. An address naming no real eval falls back to the feed's first
  row and canonicalizes; a deep link to an eval that exists is never silently rewritten before the feed has
  shown it.
- **A MASTER-DETAIL — a full page deserves a full-height detail, and the DETAIL is the protagonist.** The
  **left column** is the [[evals-feed]] list — the latest reading per (node, scenario), fresh leading, video
  first — under its own kind dropdown (that filter is the feed's own state; this node owns the page shell,
  never the filters). Its rows are title-only, so the column stays **SLIM** — it never crowds the detail
  (the human called the wide sidebar: the list is a picker, not a reading surface) — and a **fold toggle**
  (the shared [[fold-toggle]] icon button) collapses it to a thin strip, giving the whole width to the
  detail workspace once a human is working one
  eval; the strip itself is the unfold affordance, and the folded list keeps its state (filters, selection,
  j/k) — the fold is pure geometry. The [[side-nav]] rail names the page, so the column carries no title of
  its own. The **right pane** is the full-height [[event-detail]] of the one selection — **selection IS
  detail** (no Enter, no in-place expansion): picking an eval row renders it as the event detail — the media
  stage under the review-track scrubber, the A/B strip in the header, and the (node, scenario) remark rail +
  docked composer. **j/k walk the feed** (folded or not) and the detail follows; a key typed into an input
  is never captured. The section contents are their own nodes ([[evals-feed]], [[event-detail]]) — this node
  owns the page shell: the split, the fold, the selection, and the j/k routing. That shell is ONE exported
  component (`EvalMasterDetail`), and it is deliberately SHARED: the session console's Eval tab
  ([[review-proof]]) renders the same shell around its own worktree-rooted list, so the two eval
  master-detail homes cannot drift apart on geometry, fold, or keys. The list CHROME is one grammar too:
  the feed and the [[issues-view]] drain wear the SAME filter-control language (ONE shared dropdown filter
  component — the feed's kind filter and the drain's store filter are literally one control; chips and any
  New/action button sharing that height and radius; the count-meta pushed to its row's end), the SAME uniform single-line rows (the title truncates,
  it never wraps — both pickers keep one even rhythm), and the SAME unhurried spacing over a hairline-soft
  row divider — so the two top-level pages read as ONE surface, never two dialects of a picker.
- **One data path — the feed rides the app's one board poll.** The list fetches nothing of its own: the
  board nodes arrive as a prop from the app's single board poll + SSE ([[evals-feed]]). A remark authored in
  the [[event-detail]] composer writes through the CLI-parity `/api/remarks` and then refreshes the
  BOARD — the eval's remark thread is the server overlay folded in through the board ([[event-detail]] /
  [[eval-issue-split]]), so it needs no issues-list reload; the Issues page's list stays a separate data
  path. A `@session`/`@new` in that composer **dispatches** ([[mentions]]), and the returned one-line
  dispatch summary (`@ new→<session>`) is **echoed briefly** as a page notice — the same flash the
  [[issues-view]] page gives its composers; a summons is never silent.
