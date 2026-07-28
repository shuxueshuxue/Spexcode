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
  - name: cold-review-navigation
    tags: [frontend-e2e]
    description: >
      Against the branch-local backend with the real session/eval/issue stores, open fresh top-level
      #/evals and #/issues controls, record every review request and graph request, then repeat the route
      navigation after the Sessions page has painted its board projection. Capture request URL, status,
      ETag/revision, route shell/runtime presence, and the first painted rows.
    expected: >
      Each cold review route issues its committed page request and paints rows when that response completes;
      the lightweight Evals shell does not mint a second same-identity request merely because it rendered,
      and a cold graph build cannot overlap a first fallback poll that leaves the review request waiting on a
      second graph flight. Sessions-first navigation is a recovery control, not a required transport for the
      review page.
---

# measuring page-state

The pure page-window and parsing projection is measured at the unit layer. Real anchor history, responsive
layout, accessibility, request size, and scroll restoration are measured by [[review-chrome]] in Chromium.
