---
title: review-filters
status: active
hue: 205
desc: One pure Issues/Evals filter engine with domain data adapters, consumed by canonical URL-owned ListViews and the compact Spec Information panes without duplicating parsing or field semantics.
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
  - spec-dashboard/src/icons.jsx
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
  - spec-dashboard/src/styles.css
---

# review-filters

Issues and Evals travel through **one filtering mechanism** wherever they are listed. A domain adapter is
data: it names searchable fields, real facets, section membership, absent-field behavior, option labels,
and the one shared liveness join. The engine normalizes state, applies every active dimension
conjunctively, derives section counts and data-backed options, and keeps a vanished active value clearable.
It invents no field and silently omits a facet with no meaningful choice.

The two consumers own different state homes, not different semantics. [[issues-view]] and [[evals-feed]]
read/write canonical hash query state through [[review-chrome]]; every human change remains a history push
and browser Back replays it. [[work-pane]] and [[eval-tab]] keep state only for the lifetime of the open
Spec Information surface, surviving tab switches without minting a second address. Their compact face is
one shallow sticky search row plus the shared accessible facet overflow. It uses the same adapter options,
radio groups, keyboard/Escape behavior, and honest filtered-empty result as the full ListViews.

Surface defaults may differ where the products already differ: canonical Issues opens on outstanding work
and canonical Evals may lead with available media, while a node popup initially shows its complete bound
record. Once a value is active, parsing and matching are identical. A node-local list naturally omits node
and scope facets because they have no choice; this is absence of data, not a special-case branch.
