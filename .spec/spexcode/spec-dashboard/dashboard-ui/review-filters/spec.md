---
title: review-filters
status: active
hue: 205
desc: One pure Issues/Evals filter engine with domain data adapters — the single home of field semantics — consumed by the canonical token-query ListViews through a bridge and by the compact Spec Information panes through local state; no second parser, no second predicate.
code:
  - spec-dashboard/src/reviewFilters.js
related:
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/EvalsFeed.jsx
  - spec-dashboard/src/EventDetail.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/session.js
  - spec-dashboard/src/reviewQuery.js
  - spec-dashboard/src/reviewFilters.test.mjs
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/styles.css
---

# review-filters

Issues and Evals travel through **one filtering mechanism** wherever they are listed. A domain adapter is
data: it names searchable fields, real facets, section membership (with honest concrete-status spellings),
absent-field behavior, option labels, and the one source-session PRESENCE join ([[live-session-filter]] —
`session:present|missing`, never liveness). The engine normalizes state, applies every active dimension
conjunctively — `q` is one substring or an array of them (the token text's bare words/phrases) — derives
section counts UNDER the rest of the query and data-backed options, and keeps a vanished active value
clearable. It invents no field and silently omits a facet with no meaningful choice.

The two consumers own different state homes, not different semantics. [[issues-view]] and [[evals-feed]]
own ONE visible token text ([[review-query]] parses it; [[review-chrome]] renders it): the canonical
bridge maps parsed tokens into engine state — duplicate qualifiers last-wins, `scope:` to no predicate
(it picks the data source upstream), and any qualifier outside the page's map to the IMPOSSIBLE state,
so an unknown token stays verbatim in the text and honestly matches nothing. Every human change remains
a history push and browser Back replays it. [[work-pane]] and [[eval-tab]] keep plain structured state
only for the lifetime of the open Spec Information surface, surviving tab switches without minting a
second address. Their compact face is
one shallow sticky search row plus the shared accessible facet overflow. It uses the same adapter options,
radio groups, keyboard/Escape behavior, and honest filtered-empty result as the full ListViews.

Surface defaults may differ where the products already differ: canonical Issues opens on outstanding work,
canonical Evals on Current with the evidence default `all` (a plain enum default, never data-dependent),
while a node popup initially shows its complete bound
record. Once a value is active, parsing and matching are identical. A node-local list naturally omits node
and scope facets because they have no choice; this is absence of data, not a special-case branch.
