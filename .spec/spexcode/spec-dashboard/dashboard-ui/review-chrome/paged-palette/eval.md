---
scenarios:
  - name: bounded-review-planes
    test: spec-dashboard/test/review-pagination.e2e.mjs
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SpecSearch.jsx]
    description: >
      In real Chromium, enter Sessions and click its visible Search pill. Record review requests before and
      after opening, response item/total counts, result rows, the two see-all commands, keyboard selection,
      and the final canonical route.
    expected: >
      Before opening, no Issues/Evals request occurs. Opening issues exactly one page-1 request per review
      plane, each with at most 25 items and an honest larger server total. The palette survives its null/loading
      first paint, shows keyboard-reachable showing-25-of-N commands for truncated planes, and Enter on the
      Evals command routes to the canonical query list. No graph row array or full lite-corpus scenario list
      supplies either plane.
---

# measuring paged-palette

The dynamic proof uses the visible Search pill and real keyboard routing. Source tests only guard the data
boundary; they do not substitute for opening the palette against a live paged backend.
