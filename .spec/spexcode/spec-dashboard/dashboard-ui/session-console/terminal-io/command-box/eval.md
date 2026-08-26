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
  - name: an-ordinary-send-makes-no-transport-claim
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Against a backend built from this tree, POST one Command Box message and read the route's `delivery`
      field. Then do it again through the real browser: open the box on a live session, type a prompt, press
      Enter, and RECORD every outcome state the box paints (install the recorder before the keypress — a
      sampler awaited afterwards races the keystroke through the same channel and reports "never appeared"
      for an outcome that came and went). Read the draft afterwards and the session's own timeline.
    expected: >-
      The route answers `deferred` — it returns before attempting the handover, so it measured nothing and
      must not describe the transport. The box paints `sending` then an ACCEPTANCE, never the retry-safe
      queued warning, and releases the draft; the prompt appears on the session's timeline. Zero loss = an
      ordinary send says only what was measured. The warning is not deleted: it still belongs to a measured
      unfinished handover, where the adapter was asked and still owes the prompt.
    code: [spec-dashboard/src/SessionInterface.jsx, spec-cli/src/sessions.ts]
---

Record the real keyboard flow in the running dashboard because focus transfer and growth are dynamic behavior.
