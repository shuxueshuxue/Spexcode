---
scenarios:
  - name: explicit-resize-obeys-sync-hold
    tags: [frontend-e2e, desktop]
    description: >-
      Through the real dashboard, shrink a visible terminal while a delayed TUI makes the bridge commit a new
      grid and complete native repaint under DEC synchronized output. Record the xterm row geometry and every
      browser paint across the commit.
    expected: >-
      The renderer stays at the old grid while synchronized output is active, then applies the committed grid
      before the buffered rows render when the hold closes. The DOM moves directly from the old complete grid
      to the new complete grid; it never exposes the old buffer reflowed at the new dimensions.
---
