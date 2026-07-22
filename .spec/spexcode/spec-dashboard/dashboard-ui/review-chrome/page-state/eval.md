---
scenarios:
  - name: page-window-contract
    tags: [cli]
    test: spec-dashboard/src/reviewPage.test.mjs
    code: [spec-dashboard/src/reviewPage.test.mjs]
    description: >
      Run the pure client page-state tests: positive/invalid page parsing and the shared short, edge,
      middle, last, and overflow page-window projections.
    expected: >
      Every test passes. Positive page 1 and very large requested pages survive; invalid/non-positive input
      repairs to 1; page windows reproduce the one GitHub-shaped number/ellipsis sequence. The source gate
      also pins one in-flight map so identical concurrent page requests share one fetch.
  - name: board-refresh-quiet
    tags: [frontend-e2e]
    description: >
      Open the Evals (or Issues) list in a real browser, let the rows paint, then fire board deltas that
      change no list content — e.g. rename a live session and rename it back — while a MutationObserver
      watches the list container for any transition back into the loading-empty state.
    expected: >
      The painted rows stay on screen through every board delta: the same-request refresh is quiet (no
      lp-empty "loading…" flash, no aria-busy wipe), and only a genuine request-identity change (new
      query/page/domain) may show the loading state again.
---

# measuring page-state

The pure page-window and parsing projection is measured at the unit layer. Real anchor history, responsive
layout, accessibility, request size, and scroll restoration are measured by [[review-chrome]] in Chromium.
