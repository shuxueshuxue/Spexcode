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
      sampling document.activeElement at mousedown, through repeated mousemoves, and at mouseup. Exercise
      xterm SelectionService's complete mousedown-detail grammar against known note text: single-click drag
      between known character offsets, double-click a known word, double-click with the second press held
      while dragging across at least three words, and triple-click the note. Read the actual CSS Custom
      Highlight Range text and word count after each gesture, copy the multi-word Range, start editing from
      a middle textarea caret, make a plain click, and toggle the prompt details summary. Repeat at 1280x800
      and 390x844.
    expected: >
      The exact visible composer remains document.activeElement for the complete press/drag/release gesture.
      Every timeline result is a `timeline-sel` CSS Highlight while `window.getSelection().toString()` remains
      empty: NORMAL matches the exact character substring, a stationary WORD gesture matches exactly one word,
      WORD drag matches the complete anchor-through-focus multi-word substring instead of collapsing to its
      landing word, and LINE matches the complete note. Ctrl/Cmd+C preserves and copies the full highlighted
      Range. The first editing key clears only that custom Range and applies once through the textarea's
      continuously native caret. A direct composer press clears the Range before native caret placement. A
      plain timeline click creates no Range, and interactive descendants still perform their native click action
      without stealing the composer sink.
    related:
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/test/timeline-chat-interaction.e2e.mjs
---
# focus-return — measuring the loss

YATU through the real dashboard: exercise each session input surface, open and close search, and read
`document.activeElement`. Zero loss is return to the current visible input, never `<body>` or a hidden xterm.
