---
title: review-chrome
status: active
hue: 205
desc: The ONE shared page chrome both review surfaces render — GitHub ListView query/section/facet/overflow chrome, structured anchor rows, shared state visuals, and the standalone DetailShell — so #/evals and #/issues cannot drift into near-identical dialects.
code:
  - spec-dashboard/src/ReviewShell.jsx#ListPage
  - spec-dashboard/src/ReviewShell.jsx#DetailShell
related:
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/reviewList.test.mjs
  - spec-dashboard/src/styles.css
---

# review-chrome

## raw source

The refactor's hard rule: Evals and Issues become GitHub-style list/detail page pairs, and the two pairs
must be ONE set of components — the human forbade a near-duplicate list or detail skeleton per page. The
old master-detail era already proved the drift risk (two hand-rolled `fv-master` copies). So the shared
chrome gets its own node and its own single file: the measured ListView/query/facet/row/state primitives
and DetailShell both pages render live here; what only one page needs stays in that page. No empty
abstraction layer or page-local near-copy is allowed.

## expanded spec

- **`ListPage` is the measured GitHub ListView skeleton, not a dressed-up select row.** A quiet page-title
  line owns the page action, then a 32px query field owns free-text filtering. Beneath it is ONE bordered
  list container: its 48px metadata header carries domain section tabs + counts at the left and invisible
  facet buttons (label + down chevron) at the right, with low-frequency or width-displaced REAL facets in
  an overflow menu. The shared facet/menu primitives render only supplied options; a page with no real
  values never gets a fake button. Every human query, section, or facet change writes canonical hash-query
  state as a history PUSH, and the page re-derives the whole face from that state so Back replays it.
- **Rows use ONE two-level information grammar.** Rows arrive as data and remain REAL `<a>` anchors, but
  their content is structured through the shared row primitive: leading state visual, a wrapping title,
  secondary identity/author/time metadata, then real right-side facts such as comments, store, evidence
  kind, or scope. Desktop rows have GitHub's ~64px rhythm; at 390px the same markup grows vertically, moves
  trailing facts under the title, allows long titles to wrap, and never widens the page. `j`/`k` still move
  a visual cursor and row-context `Enter` opens its href. Inputs, textareas, and selects never yield any key
  to the list; buttons yield `j`/`k` but retain native `Enter`/Space activation, so a cursor cannot steal a
  section, facet, overflow, or page-action command. Rows without an href (a blind spot) remain inert; one
  shared empty state occupies the list container.
- **State is one data-driven primitive.** The shared mapping owns `icon + label + tone` for eval verdicts
  (fresh/stale pass/fail and unmeasured/legacy) and issue lifecycle (open vs every concluded state). Evals
  list leading marks, detail status, and every A/B reading selector consume it; Issues list and detail do
  the same. Glyphs come only from [[icon-system]] — no page-local SVG, CSS dot, or Unicode check/cross.
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
