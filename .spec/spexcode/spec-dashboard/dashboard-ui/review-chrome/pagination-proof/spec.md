---
title: pagination-proof
status: active
hue: 205
desc: The real-Chromium closure for paged review — a whole-app graph-plus-list network ledger beside history, overflow, scroll, mobile, keyboard, and accessibility evidence.
code:
  - spec-dashboard/test/review-pagination.e2e.mjs
related:
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/reviewPage.js
  - spec-cli/src/reviews.ts
---

# pagination-proof

The product proof starts before either review page opens. It records the first `/api/graph` response and
rejects any Issues/Evals row, scenario, or reading arrays that could reconstruct a main list; it then opens
Issues, trunk Evals, and scoped Evals and records every response's status, bytes, current-page item count,
total, navigation fields, and revision beside the rendered row count. Thus a bounded page endpoint cannot
hide a simultaneous full-list bootstrap.

The same real Chromium journey exercises the observable GitHub contract: anchor PUSH, both page-1 history
forms, refresh and Back/Forward replay, filter reset, last and overflow pages, detail Back scroll restoration,
loading/failure, and the shared scroll owner below the sticky status/header stack. A second 390px recording
measures wrapping, target geometry, overflow, keyboard activation, and the named accessibility navigation.
The run emits desktop/mobile videos, screenshots, a timeline, and the machine-readable network ledger used
for before/after review.
