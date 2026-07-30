---
scenarios:
  - name: command-box-control-surface
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    related: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/styles.css]
    description: >-
      In a real live session press Alt+I, author a multi-line draft using mentions (including @new), slash rows, and
      an attachment, close and reopen it, then send once while recording the interaction and geometry.
    expected: >-
      A surface named Command Box opens focused in the lower middle with its bottom edge near 78% of the pane.
      Its footer stays fixed while content grows upward without resizing xterm. The per-session draft survives
      close/reopen. A Command Box @new submission creates a worker nested under the selected session and reports
      that child alongside its delivered prompt. Completion rows preserve their control-versus-authoring behavior; a successful append-backed send
      clears and closes, while a failed send remains open with its draft and visible error. Closing returns TUI
      focus. No docked second input or type-mode indicator exists.
---

Record the real keyboard flow in the running dashboard because focus transfer and growth are dynamic behavior.
