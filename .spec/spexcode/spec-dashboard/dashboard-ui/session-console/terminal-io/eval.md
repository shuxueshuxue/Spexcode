---
scenarios:
  - name: native-input-event-driven
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-cli/test/pty-bridge.visibility-lifecycle.ts
    description: >-
      Through the running dashboard open a live agent TUI, type ordinary and IME-composed text, and drive a
      real select menu. Instrument timers and terminal WebSocket frames before app load, then leave the pane
      idle for several seconds.
    expected: >-
      xterm's native onData events produce ordered `{t:'input'}` socket messages and the agent TUI responds
      without a mode. A still pane registers no input polling or screen-content sniff. No raw-key HTTP request,
      700ms scan, type button, or menu-shape inference exists.
  - name: entrance-fit-event-driven
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, deep-link onto a LIVE session's console so the
      terminal pane mounts and enters through the `.si-term-body` entrance animation. Log every outgoing
      `{t:'resize'}` WebSocket frame and every setTimeout registration (wrapped before app load). Once
      settled, compare the fitted terminal (`.xterm-screen`) against its host (`.st-host`); then resize
      the browser window and confirm the refit still follows. Record the run as video.
    expected: >-
      The pane lands correctly fitted with no undersized→snap, driven by the entrance event channels
      alone — the `animationend` refit on `.si-term-body` (the element that actually animates) plus the
      ResizeObserver — with NO [60,180,320]ms timer chain registered at mount. The settled screen fills
      its host within one cell, exactly one initial resize frame reaches the server (no corrective second
      frame at a different size), and a window resize still refits the pane. Baseline bug-shape: three
      per-mount setTimeout refits rehearsing the fit on a clock, standing in for an animationend listener
      left dead on a stale `.si-term` selector no element carries.
---
# eval.md — terminal-io

The cluster's own loss is the pane's **timing discipline** — the [[terminal-io]] contract that the live
terminal sustains itself event-driven, never polled. Both scenarios read the schedule from outside (timer
census + WS frames) while exercising the REAL surfaces: native input into an actual agent TUI,
the actual entrance animation for the fit. Zero loss is a still, untouched pane costing zero scans and
zero rehearsal timers, while input and fit remain live.
