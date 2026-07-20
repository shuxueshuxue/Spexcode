---
scenarios:
  - name: lean-board-detail-and-search-intact
    tags: [frontend-e2e, backend-api]
    description: >
      Measure through the running dashboard against a live backend. Confirm `/api/graph` no longer carries any
      node's `body` or `parts`, or any `issues`/`openIssues`/`evals`/`scenarios` row array (payload trimmed
      >50%), yet the consumers of prose and review summaries still work off the
      hot poll: opening a node's detail lazily fetches `/api/specs/:id/content` and renders the two labelled
      cards — raw source (human) · expanded spec (agent); and the search palette, after fetching the body
      corpus from `/api/specs/lite`, still surfaces a node by a term that appears ONLY in its body prose. Watch
      the console for errors.
    expected: >
      The board's node objects carry neither `body` nor `parts` nor reconstructable review row arrays and
      the payload is >50% smaller than the
      original; opening a two-part node (e.g. `spec-cli`) shows both the `raw source` and `expanded spec` cards
      with their prose (fetched on open); a search over a body-only token (e.g. `zombie`) returns that node;
      the `/api/specs/lite` and `/api/specs/:id/content` requests return 200; the console is clean. Zero loss =
      the board shrinks with the graph overview, the two-part detail view, and body-ranked search all unchanged.
    code: [spec-cli/src/graph.ts, spec-dashboard/src/NodeView.jsx, spec-dashboard/src/SpecSearch.jsx]
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
      Confirm `/api/graph` carries no scenario or reading rows, then open a node with more than 25 timeline
      rows and switch to its eval tab in a real browser. Record the one `view=timeline` paged request, its
      response/DOM item counts and server total, the compact showing-X-of-Y summary, and the canonical View
      all anchor. Open one scenario detail to prove its full A/B history remains demand data while no other
      scenario history or more than five lightweight neighbors enter the response. Score badges
      on the graph must render unchanged off count-only reviewSummary.
    expected: >
      Graph has zero Eval/scenario rows. The node tab response and DOM each contain at most 25 rows, while
      server total and showing-X-of-Y describe the complete timeline and View all reaches the canonical
      node-filtered list. The detail alone may fetch its addressed scenario history; direct/reload keep one
      revision and no full node/session endpoint is requested. Badges/stats remain
      count-only, and a failed page is loud rather than falling back to hidden graph readings.
    code: [spec-cli/src/graph.ts, spec-dashboard/src/NodeView.jsx]
  - name: scenario-prose-off-the-board
    tags: [frontend-e2e, backend-api]
    description: >
      Confirm the board and `/api/specs/lite` contain no scenario declarations. Open the real Search pill
      and verify its Issue/Eval planes come from bounded page-1 review requests; inspect the at-most-25
      results and keyboard-reachable see-all command, then open a node Eval tab and verify expected/tracked
      prose arrives through its paged timeline request. Watch the console for errors.
    expected: >
      Graph and lite corpus carry zero scenario rows. Palette opening issues one bounded request per review
      plane and exposes server-total see-all commands; NodeView's bounded timeline still renders declared
      prose. No frontend reconstructs scenarios from graph/lite data, and the console is clean.
    code: [spec-cli/src/graph.ts, spec-cli/src/index.ts, spec-dashboard/src/corpus.js, spec-dashboard/src/SpecSearch.jsx, spec-dashboard/src/NodeView.jsx]
---
# graph-lean — measurement

YATU: measure through the running dashboard in a real browser (dev server → a live backend), not a unit
test. The loss is only visible end-to-end: the backend must actually omit prose and review rows from `/api/graph`,
the `NodeView` must lazily fetch and render the two-part cards, and the search palette must still rank nodes
over their prose via the lazily-fetched corpus — no regression to the overview. File the two-part detail
screenshot with `spex yatsu eval board-lean --scenario lean-board-detail-and-search-intact --image <png> --pass`.
