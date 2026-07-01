---
scenarios:
  - name: embedded-pane-io-and-esc-exit
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard (a real browser), open a live session's embedded terminal pane
      (TermPane): confirm it renders the tmux pane content (read via `capture-pane -p -e`), that typing in
      the separate command-line input reaches the session (`send-keys`), and that Escape exits the peek.
      Then test the arrow-key boundary: with the command input EMPTY, press ←/→/↑/↓ and watch the spec tree
      navigate (parent/child/siblings); with TEXT in the input, the same arrows edit the line instead.
    expected: >-
      xterm.js renders the live pane (the same content `capture-pane` shows); a keystroke typed into the
      command input lands in the session via `send-keys`; Escape reliably exits the peek (the custom
      `attachCustomKeyEventHandler` routes Esc → onClose rather than letting xterm swallow it). With the
      command input empty the arrows fall through to navigation — ←/→ walk parent/child, ↑/↓ walk siblings;
      once the input holds text the arrows edit the line as usual.
    code: spec-dashboard/src/TermPane.jsx
    related:
      - spec-dashboard/src/SessionTerm.jsx
---
# yatsu.md — session-peek

Measured through the real embedded pane (YATU): drive the live session in the browser and look — the tmux
client/server model means no attached terminal is needed, so the proof is that the rendered xterm matches
the pane, keystrokes round-trip through `send-keys`, and the Escape/arrow-key ownership split (xterm grabs
focus, but Esc and empty-input arrows are intercepted for the peek/navigation) behaves as specified. The
loss watched is a peek that swallows Escape or the navigation arrows, trapping the user inside the terminal.
