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
  - name: chrome-clicks-keep-tui-focus
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/terminal-chrome-focus.e2e.mjs
    code: spec-dashboard/src/SessionInterface.jsx
    related: [spec-dashboard/src/focus.js, spec-dashboard/src/ContextMenu.jsx, spec-dashboard/src/Modal.jsx, spec-dashboard/src/SessionTerm.jsx]
    description: >-
      With a live session's TUI focused, click and operate the console's chrome — zone headers, sidebar empty
      space, the list resizer (drag and reset), the Terminal tab, the active row — then type into the terminal.
      Open and exit each pop above the console (search palette, Command Box, the row context menu and its
      rename modal), and repeat the chrome clicks from the New composer.
    expected: >-
      No chrome press moves focus: the TUI helper (or the composer that owns the surface) keeps typing focus
      through every chrome interaction, and the typed proof text reaches the real tmux pane afterwards. Every
      pop that takes focus returns it to the same surface on exit — never a chrome button, never body.
---

Measure through a real browser and real tmux-backed session; a mocked key handler is not this contract.
