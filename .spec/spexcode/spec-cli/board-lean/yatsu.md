---
scenarios:
  - name: lean-board-detail-and-search-intact
    tags: [frontend-e2e, backend-api]
    description: >
      Measure through the running dashboard against a live backend. Confirm `/api/board` no longer carries any
      node's `body` or `parts` (payload trimmed >50%), yet the two consumers of that prose still work off the
      hot poll: opening a node's detail lazily fetches `/api/specs/:id/content` and renders the two labelled
      cards — raw source (human) · expanded spec (agent); and the search palette, after fetching the body
      corpus from `/api/specs/lite`, still surfaces a node by a term that appears ONLY in its body prose. Watch
      the console for errors.
    expected: >
      The board's node objects carry neither `body` nor `parts` and the payload is >50% smaller than the
      original; opening a two-part node (e.g. `spec-cli`) shows both the `raw source` and `expanded spec` cards
      with their prose (fetched on open); a search over a body-only token (e.g. `zombie`) returns that node;
      the `/api/specs/lite` and `/api/specs/:id/content` requests return 200; the console is clean. Zero loss =
      the board shrinks with the graph overview, the two-part detail view, and body-ranked search all unchanged.
    code: [spec-cli/src/board.ts, spec-dashboard/src/NodeView.jsx, spec-dashboard/src/SpecSearch.jsx]
---
# board-lean — measurement

YATU: measure through the running dashboard in a real browser (dev server → a live backend), not a unit
test. The loss is only visible end-to-end: the backend must actually omit `body`+`parts` from `/api/board`,
the `NodeView` must lazily fetch and render the two-part cards, and the search palette must still rank nodes
over their prose via the lazily-fetched corpus — no regression to the overview. File the two-part detail
screenshot with `spex yatsu eval board-lean --scenario lean-board-detail-and-search-intact --image <png> --pass`.
