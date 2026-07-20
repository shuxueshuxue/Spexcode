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
---

# measuring page-state

The pure page-window and parsing projection is measured at the unit layer. Real anchor history, responsive
layout, accessibility, request size, and scroll restoration are measured by [[review-chrome]] in Chromium.
