---
scenarios:
  - name: cold-detail-runtime-boundary
    test: spec-dashboard/test/evals-light-entry.e2e.mjs
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/Root.jsx]
    related: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/App.jsx, spec-dashboard/src/data.js]
    description: >
      In fresh desktop and phone Chromium contexts with cache disabled, open an existing Eval detail by
      its canonical URL and by the legacy session URL. Record CDP requests, EventSource and WebSocket
      creation, loaded chunks, the normalized address, and the rendered detail. From the canonical page,
      follow the real Graph rail anchor and then browser Back.
    expected: >
      Canonical and legacy links render the same detail and normalize to the canonical route. Before real
      navigation there is one bounded Eval detail request plus its evidence, with no graph request or SSE,
      no session request or socket, and no board/graph/terminal chunk. The phone renders the same responsive
      review face. Entering Graph starts the ordinary graph request and SSE exactly once; Back restores the
      detail without restarting the now-warm dashboard runtime.
---
# measuring light-entry

YATU is a cold real-browser route probe, not a component render. Chromium records the complete CDP Network
ledger until the detail and evidence settle, then uses the product's own rail anchor and browser Back to
prove both sides of the initialization boundary.
