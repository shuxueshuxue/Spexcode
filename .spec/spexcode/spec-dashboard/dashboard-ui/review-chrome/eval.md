---
scenarios:
  - name: one-chrome-two-pages
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/styles.css]
    description: >
      In a real browser at a live backend, open #/evals and #/issues and compare the two list pages'
      DOM: the 32px query, ListView container, section/facet/overflow metadata bar, structured row elements
      (tag, classes, state/title/meta/aside, hairline divider), menus, and empty-state
      class. Open direct and overflow menus by mouse and keyboard; read focus transfer, checked item,
      Arrow/Home/End roving, trigger restoration, outside dismissal, one-layer Escape, and the Chromium
      accessibility tree's named group/radio ownership. Read tablist/tab/tabpanel names and relations, and
      press Up/Down on a horizontal tab. Then open one
      eval detail and one issue detail and compare the detail skeletons: header,
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
      An active facet whose data option disappeared remains visible with an All off-switch; an inactive facet
      with no real options stays omitted. Menus and section tabs expose one roving tab stop, and Escape peels
      only the top registered layer before focus returns to its trigger. Each overflow facet is a distinct
      accessible radio group named by its visible label. The horizontal section tablist is named; every tab
      controls the one results tabpanel, the panel is labelled by the active tab, and Up/Down neither changes
      section nor suppresses normal scrolling.
  - name: list-key-routing
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/ReviewShell.jsx]
    description: >
      In a real browser on #/issues, press j to establish a row cursor. With that cursor still present,
      focus and press Enter on a section tab, a facet button, the overflow kebab, and the New action; close
      a menu and, while its trigger button retains focus, press j again. Then focus a row anchor different
      from the cursor and press Enter. Also activate a facet button with Space and type j, k, and Enter in
      the query input.
    expected: >
      Enter and Space retain each button's native command: the section changes the canonical query, the
      facet and kebab open their own menus, and New opens its composer, with no navigation to the cursor
      row. After a menu closes, j on its focused trigger still advances the cursor. INPUT, TEXTAREA, and
      SELECT targets surrender no list keys. Enter on a focused anchor follows that anchor's native href,
      never the cursor's; only row-context Enter outside a native control opens the cursor row.
---
# measuring review-chrome

Measured through the two consumer pages: the shared chrome has no page of its own, so the scenario reads
BOTH #/evals and #/issues in a real browser and diffs their skeleton DOM. The loss is any divergence —
a second head grammar, a non-anchor row, a detail skeleton one page has and the other lacks.
