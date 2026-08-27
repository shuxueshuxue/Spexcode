---
scenarios:
  - name: code-selection-actions-reach-live-session
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Open a governed `#/file` document in a real browser, drag-select source lines, and use the shared
      four-action group to open its send card. Reopen the same selection with the native context menu and
      verify that it exposes the identical four actions. Choose an active target and send. Observe the target
      session's timeline and inspect the received prompt for the path, inclusive line range, and selection token.
    expected: >-
      The file selection and its native right-click menu open the same four actions as spec prose, the old one-button affordance is absent,
      an idle session remains in the target list while an offline session is absent, and sending reaches the
      selected live session through its ordinary input route with the code-selection attachment intact.
  - name: popup-body-edit-send-direct-create
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Through the real dashboard, select a body range in the node information popup and choose Edit & Send
      with a new session target. Inspect the created session's first prompt and the settled popup/session
      screenshots.
    expected: >-
      The selected body range is encoded as one code-selection attachment in the initial create request,
      the returned session opens immediately as a HELD workspace tab (never the replaceable slot), and no empty
      launch composer or second send is required.
---
# eval.md - prose-dispatch

Measure both user surfaces through the real browser: source selections dispatch to a live session, and
popup prose selections create a session with the body chip in its first prompt.
