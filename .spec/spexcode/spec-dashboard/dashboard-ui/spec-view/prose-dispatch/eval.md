---
scenarios:
  - name: code-selection-actions-reach-live-session
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Open a governed `#/file` document in a real browser, drag-select source lines, and use the shared
      four-action group to open its send card. Choose an active target and send. Observe the target session's
      timeline and inspect the received prompt for the path, inclusive line range, and selection token.
    expected: >-
      The file selection opens the same four actions as spec prose, the old one-button affordance is absent,
      archived or dormant sessions are absent from the target list, and sending reaches the selected live
      session through its ordinary input route with the code-selection attachment intact.
  - name: popup-prose-edit-send-creates-session
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Open a node's `i`/Enter information popup, select prose in its spec pane, choose Edit & Send, keep
      the edit preset, select a new session, and send. Observe the newly returned session timeline and the
      first prompt body in the backend.
    expected: >-
      The popup spec pane exposes the same ProseActions group as the full spec document. The new-session
      action calls session creation once, carries the selected node body range as a code-selection chip in
      the initial prompt, and opens the created session without a second launch-face send.
---
# eval.md - prose-dispatch

Measure both user surfaces through the real browser: source selections dispatch to a live session, and
popup prose selections create a session with the body chip in its first prompt.
