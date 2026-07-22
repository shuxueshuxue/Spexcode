---
scenarios:
  - name: command-box-control-surface
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    related: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/styles.css]
    description: >-
      In a real live session press Cmd+I or Alt+I, author a multi-line draft using mentions, slash rows, and
      an attachment, close and reopen it, then send once while recording the interaction and geometry.
    expected: >-
      A surface named Command Box opens focused in the lower middle with its bottom edge near 64% of the pane.
      Its footer stays fixed while content grows upward without resizing xterm. The per-session draft survives
      close/reopen. Completion rows preserve their control-versus-authoring behavior; a successful atomic send
      clears and closes, while a failed send remains open with its draft and visible error. Closing returns TUI
      focus. No docked second input or type-mode indicator exists.
---

Record the real keyboard flow in the running dashboard because focus transfer and growth are dynamic behavior.
