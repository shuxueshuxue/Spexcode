---
title: review-filters
status: active
hue: 205
desc: One pure Issues filter engine with a domain data adapter — the single home of field semantics — consumed by the canonical token-query ListView through a bridge and by the compact Spec Information panes through local state; no second parser, no second predicate.
code:
  - packages/spec-core/src/review/reviewFilters.js
related:
  - packages/spec-core/src/review/index.js
  - spec-cli/src/reviews.ts
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/session.js
  - packages/spec-core/src/review/reviewQuery.js
  - spec-dashboard/src/reviewFilters.test.mjs
  - spec-dashboard/test/review-filters-one-engine.e2e.mjs
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/styles.css
---

# review-filters

Issues travel through **one filtering mechanism** wherever they are listed. Its pure module lives at
`@spexcode/spec-core/review`, the browser-safe package entry shared by the server and dashboard; that entry
contains no Node, React, store, endpoint, or service dependency. A domain adapter is data: it names
searchable fields, real facets, section membership (with honest concrete-status spellings), absent-field
behavior, option labels, and the one source-session PRESENCE join ([[live-session-filter]] —
`session:present|missing`, never liveness). The engine normalizes state, applies every active dimension
conjunctively — `q` is one substring or an array of them (the token text's bare words/phrases) — derives
section counts UNDER the rest of the query and data-backed options, and keeps a vanished active value
clearable. It invents no field and silently omits a facet with no meaningful choice. A section count is
ONE number — the section's matched rows under the rest of the query — so a chip and the popup radio it
filters read the same figure.

The consumers own different state homes, not different semantics. [[paged-review]] imports this SAME pure
module on the server, applies it before slicing, and returns the resulting full-population counts/facets;
the canonical page renders that result and never re-matches a current-page subset. [[issues-view]] owns
ONE visible token text ([[review-query]] parses it; [[review-chrome]] renders it): the canonical bridge
maps parsed tokens into engine state — duplicate qualifiers last-wins, and any qualifier outside the
page's map (or a wrong `is:` identity) to the IMPOSSIBLE state, so an unknown token stays verbatim in the
text and honestly matches nothing. One token map per domain: adding a domain is adding its map, never a
second parser. Every human change remains a history push and browser Back replays it. [[node-popup]] keeps
plain structured state only for the lifetime of the open Spec Information surface, surviving tab switches
without minting a second address. Its compact face is one shallow sticky search row plus the shared
accessible facet overflow. It uses the same adapter options, radio groups, keyboard/Escape behavior, and
honest filtered-empty result as the full ListView.

The Issue adapter exposes forge label names as the exact-match high-cardinality `label:` dimension. It is
not a second client-only tag filter: token parsing, matching, options, counts, and the bounded server slice
all travel through this engine. A local issue has no label values and therefore honestly cannot match one.

Canonical Issues opens on outstanding work (`is:issue state:open`). An active section or fixed-value facet
choice stays selectable at zero rows so it can be cleared; a node-local list naturally omits the node facet
because it has no choice — absence of data, not a special-case branch.
