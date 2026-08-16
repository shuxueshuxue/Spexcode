---
title: paged-palette
status: active
hue: 205
desc: The dashboard search palette keeps node/session ranking local but obtains bounded Issue/Eval planes from paged-review instead of graph row arrays.
code:
  - spec-dashboard/src/SpecSearch.jsx
related:
  - spec-dashboard/src/reviewPage.js
  - spec-dashboard/src/corpus.js
  - spec-dashboard/src/address.js
---

# paged-palette

The one graph/session search palette still ranks node prose from the lite corpus and live session identity
locally. Its Issue and scenario planes are demand data: while the palette is open, the debounced text drives
page 1 of `/api/issues` and current `/api/evals`; each contributes at most 25 matching rows and the palette
interleaves them with node/session hits exactly as before. `/api/specs/lite` contains node prose only, never
scenario declarations that recreate the Eval list. Opening the palette therefore pays bounded review rows,
while never opening it pays none.

Node and session planes still use the shared local lexical ranker. Issue and scenario rows have already passed
the shared server matcher, so the palette preserves each response's stable order instead of applying corpus
IDF a second time to a match-only page. In particular, an exact query returning one review row remains one
visible hit; it cannot collapse to zero because every document in that filtered slice contains the query.

Every selectable result row is a real matched node, session, Issue, or scenario. The review responses'
pagination totals are transport metadata, not searchable entities: the palette never appends synthetic
"showing N of M" rows to its ranked results. Instead, a quiet command row below those results exposes one
native anchor per non-empty review plane: **all Issues · N** and **all Evals · N**, where `N` is that page-1
response's server total. Each anchor preserves the palette's current committed text in the canonical list
query and is reached by ordinary Tab/Enter after the search input; it does not join Arrow-key entity ranking.
The same un-nested anchors stay inside the palette at the narrowest desktop width; below that breakpoint the
separate phone face remains unchanged and does not mount this desktop palette. Thus the bounded summary has a
direct route to every matching Issue and every scenario's full declared prose without moving rows back into
the graph or lite corpus.

An Issue hit routes to its detail. A measured Eval hit routes to its detail; a blind scenario routes to the
canonical node-filtered Evals list because it has no result detail. Plane boost, keyboard ownership, and
selection routing remain [[session-search]]'s single shared behavior.
