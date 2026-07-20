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
      Across both sizes and at least two dashboard themes, place open/closed Issue rows beside
      pass/fail/stale/missing Eval rows and measure each leading state box, SVG bounds, stroke, and baseline.
      Record the menu, viewport, and theme interactions as video evidence.
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
      list primitive gives every Issue/Eval leading state one stable icon box, rendered size, optical stroke,
      and alignment: changing domain, verdict, lifecycle, viewport, or theme never shifts the title column
      or row baseline, and no Eval-only CSS patch exists. The shared
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
  - name: continuable-query
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/reviewQuery.js]
    description: >
      In a real browser at a live backend, treat the token query as an editing surface you keep typing
      into: load both list pages at the bare address and at a non-default ?q=, reading the combobox value,
      focus, and caret each time; click a section tab and a facet menu option and immediately type a new
      token and press Enter; hand-append outer spaces to a default-equivalent text and submit; walk Back
      and Forward across every recorded step reading value/focus/caret and the URL; empty the input
      entirely and submit at the bare address; focus the tablist and activate a section by arrow key;
      read the aria-hidden
      overlay text and geometry against the input; take an ARIA snapshot of the search region; repeat the
      tab-then-type pass at 390px.
    expected: >
      Every committed text replays into the combobox as the trimmed tokens plus EXACTLY one trailing ASCII
      space, caret parked after it — on cold load the caret is parked without stealing page focus, while a
      section/facet/autocomplete pick, a hand submit, and a Back/Forward replay focus the input so typing
      continues immediately and lands as a well-formed next token. The trailing space is display-only:
      submit trims outer whitespace, a default-equivalent text stays/returns the bare address, any other
      text pushes ?q= with no trailing space, and Back/Forward replay never accumulates spaces or drifts
      the text. An emptied submit visibly refills the default (plus the one space) even though the bare
      address does not change; an arrow-key section activation is a builder pick and likewise releases
      focus into the input. The overlay mirrors the value glyph-for-glyph including the trailing space
      and stays aligned with the input at 1440 and 390; the input remains one native AX combobox.
  - name: token-query
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/reviewQuery.js]
    description: >
      In a real browser at a live backend, drive both list pages through the visible token query alone:
      read the default face's input text and URL; click section tabs and low-cardinality menus and read
      the input text, URL, and history depth after each; hand-type a query with an unknown qualifier and
      submit; type a bare prefix and a key:prefix and walk the inline suggestions (including scope: on a
      board with sessions); walk browser Back through every recorded step; open legacy structured-param
      and #/sessions/<id>/eval addresses; open a scoped list and one of its details; resize to 390px and
      switch themes.
    expected: >
      ONE source of truth throughout: the bare address shows the default tokens in the input; every tab
      or menu pick rewrites ONLY its token in the visible text and pushes ?q=<raw text> exactly once;
      recognized qualifiers color in the aria-hidden overlay while an unknown one stays plain, keeps
      running, and lands on the filtered-zero face with the token intact in input and URL. A key pick
      completes `key:` in place without executing; a value pick completes the token and executes;
      `scope:` suggests only sessions on the current board. Back restores URL + input text + result set
      at every level. Legacy addresses replace-normalize to the token form (live=1→session:present,
      session=<id>→scope:<id>, ok=1→state:reviewed, kind=all→the bare default); a scoped list shows the
      gates strip and its rows' details carry ?q=scope:<id> alone. At 390px the input keeps full width
      and highlight with no horizontal overflow; every theme keeps the overlay colored and aligned.
  - name: detail-header-alignment
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/styles.css]
    related: [spec-dashboard/src/ReviewShell.jsx]
    description: >
      In a real browser at a live backend, open one Issue detail and one Eval detail, each with a short
      title and with a long title that wraps, at 1440px and 390px, in en and zh. In each cell measure the
      DetailShell header row: the back anchor's getBoundingClientRect against the title FIRST LINE's box
      (a Range over the title's first text node), the back anchor's tag/href, its hit target, its
      focus-visible ring, whether a wrapped title stays aligned to the first line (never re-centers
      against the whole block), and document scrollWidth vs clientWidth.
    expected: >
      One geometry contract, owned by the shared DetailShell CSS: the back anchor's vertical center
      coincides with the title first line's visual center (within 1px) in every cell — both pages, both
      widths, both languages, short and wrapped titles — with NO page-level or hardcoded pixel offset
      tuned to one font size. A multi-line title keeps the anchor tied to its FIRST line. The anchor
      stays a REAL <a href> with a ≥24px hit target and a visible focus-visible ring; long titles wrap
      with zero horizontal document overflow.
---
# measuring review-chrome

Measured through the two consumer pages: the shared chrome has no page of its own, so the scenario reads
BOTH #/evals and #/issues in a real browser and diffs their skeleton DOM. The loss is any divergence —
a second head grammar, a non-anchor row, a detail skeleton one page has and the other lacks.
