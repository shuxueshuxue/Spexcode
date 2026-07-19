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

- **ONE visible, editable token query is the whole list state** ([[review-query]] is the engine). The
  32px combobox shows the raw text — Issues defaults to `is:issue state:open`, Evals to
  `is:eval state:current` — and every control is only a query BUILDER over the COMMITTED text: section
  tabs and low-cardinality facet menus perform token surgery and PUSH, so a pick is always visible as
  text and no control owns private filter state. Syntax highlight is a GitHub-style aria-hidden overlay
  behind the native input (native caret/selection, never contenteditable); recognized qualifiers color,
  unknown ones stay plain and run to the honest filtered zero. An emptied submit refills the default.
  High-cardinality dimensions (author/filer/node/scope) get NO enumerating dropdown: hand-typed or picked
  from the input's inline combobox+listbox autocomplete, whose candidates are bounded — values present in
  the data, `scope:` only sessions on the current board — a key pick completes in place, a value pick
  completes the token and executes; unknown or historical values still submit verbatim. `scope:<id>` is
  the worktree data source and `session:present|missing` the source-session presence — two axes, never
  conflated, and a detail address carries only the scope token. The default view is the bare address, any
  other state exactly `?q=<raw text>`; Back restores text and results level by level.
- **`ListPage` is the measured GitHub ListView skeleton.** A quiet title/action and the 32px query precede
  ONE bordered list. Its 48px header has counted section tabs left, invisible facet buttons right, and REAL
  low-frequency/width-displaced facets in overflow — the low-cardinality set only (state, verdict,
  freshness, evidence, store, source-session presence); tab counts are computed under the REST of the
  query. No real options means no fake control, and an ACTIVE value whose menu option vanished keeps a
  cheap All off-switch (the visible text is the canonical release).
  Menu open focuses the checked/first radio; Arrow/Home/End rove, selection/Escape restore the trigger,
  and outside click keeps clicked focus. Each overflow facet is its own named radio group inside the menu,
  never one mixed set with several checked items. Menus use the ONE LIFO Escape stack. The named horizontal
  tablist exposes one roving tab stop; tabs control one labelled results panel and only Left/Right/Home/End
  switch it, leaving Up/Down to normal page scrolling. Every query, section, or facet action PUSHES canonical
  hash state; Back replays it. At 390px the query input keeps its full width and highlight; displaced facets
  join the one functional overflow.
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
  list leading marks, detail status, and every A/B reading selector consume it; Issues list and detail do
  the same. Glyphs come only from [[icon-system]] — no page-local SVG, CSS dot, or Unicode check/cross.
- **`DetailShell` follows GitHub's issue grammar:** title/meta HEADER, STATUS band, MAIN content with an
  optional docked composer, and a metadata SIDE rail. Browser history is the return path. Source failure
  and honest not-found are distinct faces. At phone width the SAME themed markup becomes one column with
  side metadata above main content.
- Both components read only the shared theme/typography tokens (the `styles.css` vars) — the pages contribute
  content, never layout forks. A change to list rhythm or detail geometry lands HERE once and both pages
  move together; that is the component boundary this node exists to hold.
