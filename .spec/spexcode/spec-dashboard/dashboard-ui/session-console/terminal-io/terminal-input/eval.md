---
scenarios:
  - name: native-tui-input-and-ime
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/terminal-input.e2e.mjs
    code: spec-dashboard/src/SessionTerm.jsx
    related: [spec-cli/src/pty-bridge.ts, spec-cli/src/pty-helper.mjs, spec-cli/src/index.ts]
    description: >-
      Open a real live session in the dashboard, focus its terminal, and type through the terminal WebSocket.
      Commit three distinct Chinese IME candidates in sequence, reactivating the selected session row and the
      Terminal tab during separate compositions, then press Shift+Enter. Observe focus, the hidden composition
      textarea, the ordered socket frames, and the real tmux pane.
    expected: >-
      The terminal is focused and interactive without entering a mode. Explicit terminal activation restores
      focus without interrupting an active composition; all three current candidates arrive exactly once and
      no prior candidate is substituted. Full-width Chinese punctuation keeps its exact Unicode code points.
      Shift+Enter emits one `ESC CR` modified-Enter sequence while ordinary Enter stays `CR`. Hidden or
      disconnected viewers inject and replay nothing. All input uses xterm's one live terminal socket, with no
      dashboard raw-key HTTP batching or private focus override.
---

Measure through a real browser and real tmux-backed session; a mocked key handler is not this contract.
