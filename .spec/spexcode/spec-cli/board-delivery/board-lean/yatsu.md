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
  - name: detail-shows-spinner-while-body-loads
    tags: [frontend-e2e, desktop]
    description: >
      Open a node's detail against a backend whose `/api/specs/:id/content` is slowed (throttled) so the lazy
      body fetch is observable. While the fetch is in flight the body area must show a loading spinner (not an
      empty pane); once the content lands the spinner is replaced by the rendered body/parts. Watch the console.
    expected: >
      During the in-flight `/content` fetch the pane shows a centred spinner; after it resolves the spinner is
      gone and the two-part (or whole) body renders; the console is clean. A failed fetch would resolve to an
      empty body, never a spinner that never stops.
    code: [spec-dashboard/src/NodeView.jsx, spec-dashboard/src/styles.css]
  - name: eval-history-off-the-board
    tags: [frontend-e2e, backend-api]
    description: >
      Confirm `/api/board` carries only the latest reading per scenario (a node's `evals` length equals its
      scenario count, not its filing count), then open a node with real reading history and switch to its
      eval tab in a real browser: the tab must lazy-load the FULL timeline from `/api/specs/:id/evals` and
      render more rows than the board summary shipped, with no stuck spinner and a clean console. Score
      badges on the graph must render unchanged off the summary.
    expected: >
      Board payload roughly halves versus shipping full histories (measured ~576KB → ~270KB on the dogfood
      board); the eval tab shows the complete reading history (rows > the board's per-scenario summary
      count); badges/stats/search are pixel-identical since they always reduced to latest-per-scenario; a
      failed timeline fetch degrades to the summary readings, never an endless spinner.
    code: [spec-cli/src/board.ts, spec-dashboard/src/NodeView.jsx]
---
# board-lean — measurement

YATU: measure through the running dashboard in a real browser (dev server → a live backend), not a unit
test. The loss is only visible end-to-end: the backend must actually omit `body`+`parts` from `/api/board`,
the `NodeView` must lazily fetch and render the two-part cards, and the search palette must still rank nodes
over their prose via the lazily-fetched corpus — no regression to the overview. File the two-part detail
screenshot with `spex yatsu eval board-lean --scenario lean-board-detail-and-search-intact --image <png> --pass`.
