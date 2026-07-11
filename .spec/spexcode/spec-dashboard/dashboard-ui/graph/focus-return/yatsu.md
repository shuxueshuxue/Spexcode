---
scenarios:
  - name: esc-from-search-returns-to-input
    tags: [frontend-e2e, desktop]
    description: >
      On the session board with the session interface open and the docked ❯/New-prompt box focused, open the
      search palette (Ctrl/⌘+/), type a query, then press Esc. Read document.activeElement after the palette
      closes. The reproduction of the reported bug — measure through the real browser (Playwright), not a
      helper.
    expected: >
      After Esc, document.activeElement is the docked input (TEXTAREA.si-input, carrying data-focus-sink) —
      NOT <body>. Focus is returned to where it was, never orphaned. (On main before this node, the same
      steps leave activeElement on BODY.)
    related:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SpecSearch.jsx
      - spec-dashboard/src/SessionInterface.jsx
---
# focus-return — measuring the loss

YATU through the real dashboard: drive a browser to the session board, focus the docked input, open and Esc
the search palette, and read `document.activeElement`. Zero loss = focus lands back on the docked input
(`data-focus-sink`), never `<body>`. The A/B against an unfixed build (focus drops to `<body>`) is the proof
the boundary closes the gap.
