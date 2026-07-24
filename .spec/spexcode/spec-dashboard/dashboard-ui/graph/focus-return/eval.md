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
  - name: timeline-selection-keeps-composer-sink
    tags: [frontend-e2e, desktop, mobile]
    description: >
      In a real headless TimelineChat, focus its composer and drag across rendered conversation text while
      sampling document.activeElement at mousedown, through repeated mousemoves, and at mouseup. Copy the
      resulting Range, start editing from a middle textarea caret, double-click a word, make a plain click,
      and toggle the prompt details summary. Repeat at 1280x800 and 390x844.
    expected: >
      The exact visible composer remains document.activeElement for the complete press/drag/release gesture.
      Drag and double-click create copyable document text selections without native focus transfer; the first
      editing key clears that Range, re-arms the textarea start/end saved before the Range existed, and applies
      once, while Ctrl/Cmd+C preserves and copies it. A direct composer press clears the Range before native
      caret placement. A plain timeline click creates no Range, and interactive descendants still perform their native
      click action without stealing the composer sink.
    related:
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/test/timeline-chat-interaction.e2e.mjs
---
# focus-return — measuring the loss

YATU through the real dashboard: exercise each session input surface, open and close search, and read
`document.activeElement`. Zero loss is return to the current visible input, never `<body>` or a hidden xterm.
