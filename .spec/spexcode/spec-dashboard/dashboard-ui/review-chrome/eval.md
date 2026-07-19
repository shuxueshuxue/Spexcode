---
scenarios:
  - name: one-chrome-two-pages
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/styles.css]
    description: >
      In a real browser at a live backend, open #/evals and #/issues and compare the two list pages'
      DOM: the head container class, the row elements (tag, classes, hairline divider), the empty-state
      class. Then open one eval detail and one issue detail and compare the detail skeletons: header,
      status band, main column, side rail, docked composer classes. Resize to 390px on a detail page and
      read the column order.
    expected: >
      Both list pages render the SAME ListPage chrome — one `.lp-head` (control row over chip row), rows
      as `.lp-row` REAL anchors in one uniform single-line rhythm, one `.lp-empty` — and both detail
      pages the SAME DetailShell skeleton (`.ds-head` title, `.ds-status`, `.ds-main` beside `.ds-side`,
      the composer in `.ds-compose` docked sticky at the main column's foot). No page-local fork of
      either skeleton exists in the DOM. At phone width the SAME markup reflows to one column with the
      side rail FIRST. Zero loss = the two review surfaces are literally one chrome, so they cannot
      drift into two dialects.
---
# measuring review-chrome

Measured through the two consumer pages: the shared chrome has no page of its own, so the scenario reads
BOTH #/evals and #/issues in a real browser and diffs their skeleton DOM. The loss is any divergence —
a second head grammar, a non-anchor row, a detail skeleton one page has and the other lacks.
