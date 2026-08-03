---
scenarios:
  - name: cold-detail-runtime-boundary
    test: spec-dashboard/test/evals-light-entry.e2e.mjs
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/Root.jsx]
    related: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/App.jsx, spec-dashboard/src/data.js]
    description: >
      In fresh desktop and phone Chromium contexts with cache disabled, open the canonical Evals LIST and
      an existing Eval detail by its canonical URL and by the legacy session URL. Record CDP requests,
      EventSource and WebSocket creation, loaded chunks, the normalized address, and the rendered list/detail.
      From the canonical list/detail pages, follow the real Graph rail anchor and then browser Back.
    expected: >
      The trunk list, canonical detail, and legacy detail render their Evals face; legacy links normalize to
      the canonical route. Before real board navigation there is only one bounded list/detail request plus
      any detail evidence, with no graph request or SSE, no session request or socket, and no board/graph/
      terminal chunk. The phone renders the same responsive review face. Entering Graph starts the ordinary
      graph request and SSE exactly once; Back restores the list/detail without restarting the now-warm runtime.
---
# measuring light-entry

YATU is a cold real-browser route probe, not a component render. Chromium records the complete CDP Network
ledger until the detail and evidence settle, then uses the product's own rail anchor and browser Back to
prove both sides of the initialization boundary.
