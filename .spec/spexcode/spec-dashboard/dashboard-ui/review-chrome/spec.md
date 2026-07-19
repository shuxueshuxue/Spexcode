---
title: review-chrome
status: active
hue: 205
desc: The ONE shared page chrome both review surfaces render — ListPage (notice/error, controls, chips, anchor rows, empty state, j/k cursor) and DetailShell (GitHub-grammar header, main + metadata rail, distinct failed/not-found faces, phone metadata-first reflow) in one file, so #/evals and #/issues can never drift into near-identical dialects.
code:
  - spec-dashboard/src/ReviewShell.jsx#ListPage
  - spec-dashboard/src/ReviewShell.jsx#DetailShell
related:
  - spec-dashboard/src/FilterSelect.jsx
  - spec-dashboard/src/styles.css
---

# review-chrome

## raw source

The refactor's hard rule: Evals and Issues become GitHub-style list/detail page pairs, and the two pairs
must be ONE set of components — the human forbade a near-duplicate list or detail skeleton per page. The
old master-detail era already proved the drift risk (two hand-rolled `fv-master` copies). So the shared
chrome gets its own node and its own single file: what both pages render is here; what only one page needs
stays in that page. No empty abstraction layers — this file holds exactly the two components the pages
share, nothing speculative.

## expanded spec

- **`ListPage`** is the list page's whole skeleton: an optional notice line, an optional fail-loud alert,
  then a sticky head — the CONTROL
  row (the shared filter grammar: `FilterSelect` dropdowns and any action button
  sharing one height/radius) over the CHIP row (small count/toggle chips, rendered only while it has
  chips) — then the rows, then the one empty-state note when no row survives the filters. Rows arrive as
  data (`{ key, href, cur, content }`) and render as REAL `<a>` anchors in one uniform single-line rhythm
  (title truncates, never wraps) over a hairline-soft divider — copy-link and middle-click work because
  the row IS a link, and a plain click is a normal hash-push navigation. `j`/`k` move a visual CURSOR
  (never a selection — there is no detail pane to drive) and `Enter` opens the cursor row's href; keys
  typed into inputs are never captured. Rows without an `href` (e.g. a blind-spot line) render inert.
- **`DetailShell`** is the detail page's skeleton, GitHub's issue-page grammar measured from the live
  product: a HEADER with the title and its trailing identity meta, a STATUS band under it, then a
  two-column body — the MAIN column (the page's content, with an optional composer docked at its foot)
  beside a fixed-width metadata SIDE rail. There is NO fake back button — the browser's history is the
  return path — but an unavailable source (`failure`) renders an alert face distinct from the honest
  not-found face (`missing`); both can link back to the list, and only the latter claims the object does not
  exist. At phone width the SAME markup reflows to ONE column with the side rail's metadata ABOVE the main
  column (the 390px GitHub order), styled by the shared theme tokens — never a second mobile component.
- Both components read only the shared theme/typography tokens (the `styles.css` vars) — the pages contribute
  content, never layout forks. A change to list rhythm or detail geometry lands HERE once and both pages
  move together; that is the component boundary this node exists to hold.
