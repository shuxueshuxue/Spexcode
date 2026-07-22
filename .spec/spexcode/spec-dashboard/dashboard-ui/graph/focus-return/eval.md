---
scenarios:
  - name: esc-from-search-returns-to-current-input
    tags: [frontend-e2e, desktop]
    description: >
      On the session board repeat from New's textarea, a live focused xterm, and an open Command Box. Open the
      search palette, type a query, press Esc, and read document.activeElement after it closes.
    expected: >
      After Esc, focus returns to the exact surviving ticket; if it vanished, it lands on that surface's sole
      visible data-focus-sink (New, Command Box, or active xterm), never body or a hidden session.
    related:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SpecSearch.jsx
      - spec-dashboard/src/SessionInterface.jsx
---
# focus-return — measuring the loss

YATU through the real dashboard: exercise each session input surface, open and close search, and read
`document.activeElement`. Zero loss is return to the current visible input, never `<body>` or a hidden xterm.
