---
title: pagination-evidence
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

# pagination-evidence

The product evidence starts before the Issues page opens. It records the first `/api/graph` response and
rejects any Issues row arrays that could reconstruct a main list, and it measures that the Graph entry and the
open search palette make no `/api/issues` request at all ([[paged-palette]]). It then enters Issues from the
rail and records every list response's status, bytes, current-page item count, total, source total,
navigation fields, and revision beside the rendered row count, and every issue detail as one single-object
`/api/issues/<id>` read whose id is the clicked row's own. Each wait is pinned to the exact committed query
text and page it expects, so a pane or dock request for the same endpoint cannot stand in for the canonical
list; at the end of the desktop journey the whole request log must contain no Issues list read without a `q`
and a positive `page`. Thus a bounded page endpoint cannot hide a simultaneous full-list bootstrap.

The same real Chromium journey exercises the observable GitHub contract on that one list: anchor PUSH, both
page-1 history forms, refresh and Back/Forward replay, the Closed section resetting to a bare `?q=` address
while the server receives page 1, `q`-before-`page` serialization in both the address and the request, the
last page's disabled Next, two overflow pages with empty items and continuing Previous/Next, detail Back
replaying the `q&page=1` form, detail Back restoring the exact scroll offset the click snapshotted under the
pane's own address, the loading and failure faces, and the shared scroll owner below the sticky header. Hidden
pool documents stay mounted beside an open detail, so every DOM reading is scoped to what is shown. A second
390px recording measures wrapping, target geometry, overflow, keyboard activation, and the named accessibility
navigation. The run emits desktop/mobile videos, screenshots, a timeline, and the machine-readable network
ledger used for before/after review.
