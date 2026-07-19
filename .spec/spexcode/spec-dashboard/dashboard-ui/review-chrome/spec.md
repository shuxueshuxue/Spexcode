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

Evals and Issues are GitHub-style list/detail pairs built from ONE component set. The old master-detail
copies proved the drift risk. Shared ListView/query/facet/row/state primitives and DetailShell live here;
domain-only behavior stays in its page. No empty abstraction or page-local near-copy is allowed.

## expanded spec

- **`ListPage` is the measured GitHub ListView skeleton.** A quiet title/action and 32px query precede ONE
  bordered list. Its 48px header has counted section tabs left, invisible facet buttons right, and REAL
  low-frequency/width-displaced facets in overflow. No real options means no fake control, but an ACTIVE
  value whose option vanished keeps an All off-switch, including dead session scope after failed reload.
  Menu open focuses the checked/first radio; Arrow/Home/End rove, selection/Escape restore the trigger,
  and outside click keeps clicked focus. Each overflow facet is its own named radio group inside the menu,
  never one mixed set with several checked items. Menus use the ONE LIFO Escape stack. The named horizontal
  tablist exposes one roving tab stop; tabs control one labelled results panel and only Left/Right/Home/End
  switch it, leaving Up/Down to normal page scrolling. Every query, section, or facet action PUSHES canonical
  hash state; Back replays it.
- **Rows use ONE two-level information grammar.** Rows arrive as data and remain REAL `<a>` anchors, but
  their content is structured through the shared row primitive: leading state visual, a wrapping title,
  secondary identity/author/time metadata, then real right-side facts such as comments, store, evidence
  kind, or scope. Desktop rows have GitHub's ~64px rhythm; at 390px the same markup grows vertically, moves
  trailing facts under the title, allows long titles to wrap, and never widens the page. `j`/`k` still move
  a visual cursor and row-context `Enter` opens its href. Inputs/textareas/selects yield no list keys;
  buttons keep native Enter/Space while allowing `j`/`k`; a focused anchor's Enter follows its OWN href,
  not the cursor. Blind rows stay inert. One shared empty state distinguishes a vacant dataset from a
  non-empty dataset whose current view matches nothing.
- **State is one data-driven primitive.** The shared mapping owns `icon + label + tone` for eval verdicts
  (fresh/stale pass/fail and unmeasured/legacy) and issue lifecycle (open vs every concluded state). Evals
  list leading marks, detail status, and every A/B reading selector consume it; Issues list/detail and the
  compact `IssueCard` entries consume the same issue half. Glyphs come only
  from [[icon-system]] — no page-local SVG, CSS dot, raw status pill, or Unicode check/cross. Small overview
  surfaces may add counts beside the primitive, but never mint another state mapping.
- **`DetailShell` follows GitHub's issue grammar:** title/meta HEADER, STATUS band, MAIN content with an
  optional docked composer, and a metadata SIDE rail. Browser history is the return path. Source failure
  and honest not-found are distinct faces. At phone width the SAME themed markup becomes one column with
  side metadata above main content.
- Both components read only the shared theme/typography tokens (the `styles.css` vars) — the pages contribute
  content, never layout forks. A change to list rhythm or detail geometry lands HERE once and both pages
  move together; that is the component boundary this node exists to hold.
