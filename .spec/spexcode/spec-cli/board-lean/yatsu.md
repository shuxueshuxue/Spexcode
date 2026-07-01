---
scenarios:
  - name: lean-board-still-renders-parts
    tags: [frontend-e2e, backend-api]
    description: >
      Measure through the running dashboard against a live backend. Confirm `/api/board` no longer carries
      any node's `parts` (the payload is trimmed ~22%), yet opening a parts-bearing node's detail still shows
      the two labelled cards — raw source (human) · expanded spec (agent) — reconstructed client-side from
      `body`. Also confirm the search palette still returns node results ranked over `body` (so dropping parts
      did not touch the search corpus). Watch the console for errors.
    expected: >
      The board's node objects have no `parts` field and are byte-smaller than before; opening a two-part
      node (e.g. `spec-cli`) renders both the `raw source` and `expanded spec` cards with their prose; a
      search over a body-only term surfaces the node; the console is clean. Zero loss = the board shrinks with
      the graph overview, the two-part detail view, and search all unchanged.
    code: [spec-cli/src/board.ts, spec-dashboard/src/NodeView.jsx]
---
# board-lean — measurement

YATU: measure through the running dashboard in a real browser (dev server → a live backend), not a unit
test. The loss is only visible end-to-end: the backend must actually omit `parts` from `/api/board`, and the
`NodeView` must reconstruct the two-part cards from `body` with no round-trip and no regression to the overview
or the search palette. File the two-part detail screenshot with `spex yatsu eval board-lean --scenario
lean-board-still-renders-parts --image <png> --pass`.
