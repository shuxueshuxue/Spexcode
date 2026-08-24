---
scenarios:
  - name: pooled-view-route-scope
    description: >
      Exercise the shell's ViewScope contract with an active and hidden pooled pane. Submit open, hold, and
      own-query intents, then update the pooled entry and submit again.
    expected: >
      Active intents dispatch one frozen typed address to the shell; malformed addresses fail at the boundary;
      hidden panes return inactive without dispatch; reactivation updates the scope route before dispatch.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/viewScope.js, spec-dashboard/src/viewScope.test.mjs, spec-dashboard/src/ViewScope.jsx, spec-dashboard/src/Shell.jsx]
  - name: review-does-not-inherit-workspace-chrome
    description: >
      In a real browser, seed persisted tabs including legacy evals and issues entries, reload the graph,
      then navigate to an eval detail and back to graph. Inspect visible chrome and the normalized storage.
    expected: >
      Loading silently removes evals/issues entries from persisted tabs. Review has no Explorer, dock, or tab
      strip; graph has all three. Returning to graph preserves the remaining workspace tab set.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/WorkspaceSurface.jsx, spec-dashboard/src/tabs.js]
  - name: registry-owns-view-route-boundary
    description: >
      Exercise a ViewScope with the registry route contract and submit an intent for an unregistered page,
      followed by a registered page and a resident document predicate.
    expected: >
      The unregistered route fails before shell dispatch; the registered route dispatches one frozen intent;
      the registry is the only source for document/resident ownership.
    tags: [desktop]
    code: [spec-dashboard/src/viewScope.js, spec-dashboard/src/viewScope.test.mjs, spec-dashboard/src/viewRegistry.js, spec-dashboard/src/viewRegistry.test.mjs, spec-dashboard/src/views.jsx, spec-dashboard/src/Shell.jsx]
  - name: resident-resource-budget
    description: >
      In a real Chromium session, visit three online session documents, Spec, Evals, and Issues, then repeat
      the session/document switches and hold the final session for at least 60 seconds. Record aggregate xterm,
      WebSocket, ResizeObserver, mounted-pane, heap, script, and task counters.
    expected: >
      Every requested route resolves; the mounted pool has one visible pane and remains bounded; hidden session
      panes do not create a growing xterm/observer/socket population; sockets and observers created during route
      transitions are closed/disconnected; heap is sampled as a noisy metric and must not be treated as a leak
      without monotonic DOM/resource growth. The reading carries sanitized JSON counters and a final screenshot.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/SessionTerm.jsx, spec-dashboard/test/keep-alive.e2e.mjs]
---

Measure YATU through the built dashboard in this worktree and a real browser against the running Spex backend.
Use the `surface-shell-legacy-tabs` screenshot for migration and the review/workspace surface screenshots for
the chrome boundary.
