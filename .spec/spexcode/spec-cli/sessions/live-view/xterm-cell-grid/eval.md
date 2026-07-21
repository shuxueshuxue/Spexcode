---
scenarios:
  - name: wide-glyphs-stay-inside-cell-grid
    tags: [frontend-e2e, desktop]
    description: >-
      Through the real dashboard, render terminal rows that end at the final column with long Latin, CJK,
      emoji, braille, ambiguous-width, and mixed-style runs. Repeat before and after a large-to-small resize at
      DPR 1, 1.25, 1.5, and 2, measuring every DOM span and screenshotting the right edge.
    expected: >-
      Every span's explicit box equals the terminal cells it represents and no box crosses its row or host.
      Font fallback and DPR may change glyph ink inside a cell but cannot accumulate advance drift, hide the
      last one or two characters, or shift later spans. No guessed host gutter or sacrificed column is present.
  - name: selection-keeps-the-cell-grid
    tags: [frontend-e2e, desktop]
    description: >-
      In a busy real dashboard terminal, drag a selection across mixed-width and styled text, hold it while
      application output continues, and measure every rebuilt row/span before, during, and after the drag.
    expected: >-
      The selection remains active, selected foreground text stays visible including its first cell, every
      rebuilt span retains its explicit cell box, and row geometry moves by 0 px with no overflow or jitter.
---

# xterm-cell-grid - yatsu

Acceptance is a real browser measurement against the actual xterm DOM renderer, not a source assertion. The
rightmost cell must remain legible across wide glyph classes, resize direction, and DPR while the reported xterm
grid still consumes every column that fits its host.
