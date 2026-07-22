---
scenarios:
  - name: native-tui-input-and-ime
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-cli/test/pty-bridge.visibility-lifecycle.ts
    code: spec-dashboard/src/SessionTerm.jsx
    related: [spec-cli/src/pty-bridge.ts, spec-cli/src/pty-helper.mjs, spec-cli/src/index.ts]
    description: >-
      Open a real live session in the dashboard, focus its terminal, type ordinary text and navigation keys,
      then use a browser IME to compose Chinese text and commit it. Observe the agent TUI and the terminal
      WebSocket while switching the session hidden and visible.
    expected: >-
      The terminal is focused and interactive without entering a mode. xterm emits ordered input data through
      the same live terminal socket and the agent TUI receives ordinary, navigation, and committed IME text
      exactly once. Hidden or disconnected viewers inject and replay nothing; returning restores focus and
      subsequent input works. No dashboard raw-key HTTP batching or hand-written key encoding participates.
---

Measure through a real browser and real tmux-backed session; a mocked key handler is not this contract.
