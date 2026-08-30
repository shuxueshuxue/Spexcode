---
scenarios:
  - name: native-tui-input-and-ime
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/terminal-input.e2e.mjs
    code: spec-dashboard/src/SessionTerm.jsx
    related: [spec-cli/src/pty-bridge.ts, spec-cli/src/pty-helper.mjs, spec-cli/src/index.ts]
    description: >-
      Open a real live session in the dashboard, focus its terminal, and type ordinary ASCII through the terminal
      WebSocket. Commit three distinct Chinese IME candidates in sequence, reactivating the selected session row
      and the Terminal tab during separate compositions; then send physical comma and period keys whose browser-native
      text is full-width Chinese punctuation, and press Shift+Enter. Observe focus, the hidden composition textarea,
      the ordered socket frames, and the real tmux pane.
    expected: >-
      The terminal is focused and interactive without entering a mode, and ordinary printable keys remain exact.
      Explicit terminal activation restores focus without interrupting an active composition; all three current candidates arrive exactly once and
      no prior candidate is substituted. The punctuation keys keep the browser/IME's full-width Unicode text
      instead of xterm's ASCII physical-key mapping.
      Shift+Enter emits one `ESC CR` modified-Enter sequence while ordinary Enter stays `CR`. Hidden or
      disconnected viewers inject and replay nothing. All input uses xterm's one live terminal socket, with no
      dashboard raw-key HTTP batching or private focus override.
  - name: right-edge-pane-still
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/terminal-hscroll.e2e.mjs
    code: spec-dashboard/src/styles.css
    related: [spec-dashboard/src/SessionTerm.jsx]
    description: >-
      Focus a real live terminal, type ordinary keys until the cursor sits in the rightmost columns, then
      open a Chinese IME composition there and commit it. Watch every ancestor of xterm's hidden composition
      textarea (the console chrome around the pane) plus the pane's on-screen x position through the whole
      march–compose–commit sequence.
    expected: >-
      The pane never moves: no ancestor of the composition textarea acquires a scrollLeft/scrollTop, and the
      xterm element's on-screen position is identical before, during, and after the right-edge composition —
      the browser's caret-reveal finds no scroll container to drag sideways. The committed candidate still
      reaches the real tmux pane, so the stillness costs nothing on the IME path.
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
  - name: pane-node-reference-opens-the-node
    tags: [frontend-e2e, desktop, backend-api]
    code: spec-dashboard/src/SessionTerm.jsx
    related: [spec-dashboard/src/terminal/SessionTerminal.tsx, spec-dashboard/src/terminal/transport.ts]
    description: >-
      Open a real live agent session's terminal pane while its TUI has mouse tracking active, with a line on
      screen holding both a `[[node-id]]` that resolves on the current board and one that does not. Hover the
      resolving reference and read the pane's cursor, click it, then return to the pane and click the
      unknown one. Before touching anything, read what the pane draws over the reference.
    expected: >-
      The resolving reference is MARKED WITHOUT BEING TOUCHED: a pointer-transparent overlay draws a rule on
      exactly the cells the reference occupies, so the door is visible before the pointer finds it, and that
      overlay neither moves the pane nor swallows the click. Then the reference behaves as a link: hovering
      it shows the link cursor and clicking it opens that node's
      `#/spec/<id>` document, the same door the transcript's anchor gives. The unknown id is not a link and
      clicking it leaves the reader on the session. An active mouse-tracking mode suppresses neither, and a
      reference the TUI wrapped across two rows is simply left unlinked rather than underlining the wrong cells.

  - name: dashboard-terminal-build-and-warm-switch
    tags: [frontend-e2e]
    test: spec-dashboard/src/terminal/render.test.tsx
    code: spec-dashboard/src/terminal/SessionTerminal.tsx
    related: [spec-dashboard/package.json, spec-dashboard/src/terminal/index.ts, spec-dashboard/scripts/patch-xterm-sync-resize.mjs, spec-dashboard/test/session-term-warm-switch.e2e.mjs]
    description: Build and server-render the dashboard terminal, then run its warm-switch terminal scenario on the rebuilt dashboard.
    expected: The dashboard terminal test passes through react-dom/server, the dashboard build must apply the xterm 6.0.0 patch or fail loudly, and the dashboard must keep mounted terminals across a session switch while hidden output is withheld and the visible session repaints.

---

Measure through a real browser and real tmux-backed session; a mocked key handler is not this contract.
