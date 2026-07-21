---
scenarios:
  - name: bounded-review-planes
    test: spec-dashboard/test/review-pagination.e2e.mjs
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SpecSearch.jsx]
    description: >
      In real Chromium, enter Sessions and click its visible Search pill. Record review requests before and
      after opening, response item/total counts, the ranked real-entity rows, the absence of pagination-summary
      pseudo-results, then type a returned scenario name and record keyboard selection plus the selected
      entity's final route.
    expected: >
      Before opening, no Issues/Evals request occurs. Opening issues exactly one page-1 request per review
      plane, each with at most 25 items and an honest larger server total. The palette survives its null/loading
      first paint and ranks only real entities without adding showing-25-of-N / see-all rows. Typing a real
      scenario issues another bounded query, exposes that Eval row to the keyboard, and Enter routes to its
      detail or canonical node-filtered list. No graph row array or full lite-corpus scenario list supplies
      either plane.
---

# measuring paged-palette

The dynamic proof uses the visible Search pill and real keyboard routing. Source tests only guard the data
boundary; they do not substitute for opening the palette against a live paged backend.
