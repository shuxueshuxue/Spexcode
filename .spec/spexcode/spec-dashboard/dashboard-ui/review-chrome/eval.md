---
scenarios:
  - name: one-chrome-two-pages
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/styles.css]
    description: >
      In a real browser at a live backend, open #/evals and #/issues and compare the two list pages'
      DOM: the 32px query, ListView container, section/facet/overflow metadata bar, structured row elements
      (tag, classes, state/title/meta/aside, hairline divider), menus, and empty-state
      class. Then open one eval detail and one issue detail and compare the detail skeletons: header,
      status band and state SVG, main column, side rail, docked composer classes. Resize list and detail to
      390px; read facet visibility, overflow contents, row geometry, body scroll width, and column order.
    expected: >
      Both list pages render the SAME ListPage chrome — a `.rl-query`, one bordered `.rl-list`, one
      `.lp-head` with counted section tabs left and real invisible facet buttons + functional overflow
      right, `.lp-row` REAL anchors whose shared `.rl-row-grid` holds state/title/meta/aside, and one
      `.lp-empty` — and both detail
      pages the SAME DetailShell skeleton (`.ds-head` title, `.ds-status`, `.ds-main` beside `.ds-side`,
      the composer in `.ds-compose` docked sticky at the main column's foot). No page-local fork of
      either skeleton exists. Desktop query/header/row measure approximately 32/48/64px. At 390px query
      width is viewport minus 32px, metadata is ~49px, only the primary facet remains beside tabs and all
      displaced real facets are usable in kebab; a long title wraps to at most three lines with no body or
      document horizontal overflow. The SAME detail markup reflows to one column with side rail FIRST.
      Eval list/detail/A-B and Issue list/detail states use the same `.review-state` SVG mapping. The shared
      empty primitive distinguishes a vacant dataset from a non-empty dataset whose current view matches zero.
  - name: list-key-routing
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ReviewShell.jsx]
    description: >
      In a real browser on #/issues, press j to establish a row cursor. With that cursor still present,
      focus and press Enter on a section tab, a facet button, the overflow kebab, and the New action; close
      a menu and, while its trigger button retains focus, press j again. Also activate a facet button with
      Space and type j, k, and Enter in the query input.
    expected: >
      Enter and Space retain each button's native command: the section changes the canonical query, the
      facet and kebab open their own menus, and New opens its composer, with no navigation to the cursor
      row. After a menu closes, j on its focused trigger still advances the cursor. INPUT, TEXTAREA, and
      SELECT targets surrender no list keys, while row-context j/k/Enter continue to walk and open rows.
---
# measuring review-chrome

Measured through the two consumer pages: the shared chrome has no page of its own, so the scenario reads
BOTH #/evals and #/issues in a real browser and diffs their skeleton DOM. The loss is any divergence —
a second head grammar, a non-anchor row, a detail skeleton one page has and the other lacks.
