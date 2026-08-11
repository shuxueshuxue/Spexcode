---
scenarios:
  - name: command-box-new-worker
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/command-box-new.e2e.mjs
    related: [spec-cli/src/mentions-command.api.test.ts]
    description: >-
      Start the dashboard and backend over a fresh temporary project with one live fake-harness session and
      one named `fake` launcher. Open that session's Command Box, type `@`, choose `@new`, choose the
      launcher, append work text, and submit through the browser.
    expected: >-
      The first pick changes the draft to `@new:` and the launcher pick to `@new:fake `; the submitted
      prompt remains in the selected session. The dashboard shows the backend's spawned-worker receipt in
      its shared success notice, and exactly one created session records that selected session as `parent`
      and `fake` as its launcher. An ordinary `@session` token remains a passive reference.
  - name: command-box-control-surface
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    related: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/styles.css]
    description: >-
      In a real live session press Alt+I, author a multi-line draft using session and node references, slash rows, and
      an attachment, close and reopen it, then send once while recording the interaction and geometry.
    expected: >-
      A surface named Command Box opens focused in the lower middle with its bottom edge near 78% of the pane.
      Its footer stays fixed while content grows upward without resizing xterm. The per-session draft survives
      close/reopen. A Command Box @session submission remains in the selected session's delivered prompt and
      never wakes the referenced session. Completion rows preserve their control-versus-authoring behavior; a successful append-backed send
      clears and closes, while a failed send remains open with its draft and visible error. Closing returns TUI
      focus. No docked second input or type-mode indicator exists.
---

Record the real keyboard flow in the running dashboard because focus transfer and growth are dynamic behavior.
