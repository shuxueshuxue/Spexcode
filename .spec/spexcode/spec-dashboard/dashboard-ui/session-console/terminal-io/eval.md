---
scenarios:
  - name: menu-sniff-event-driven
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard in a real browser, open the session console on a LIVE session whose
      pane is a real agent TUI. Instrument the page's timer clocks BEFORE the app loads (wrap
      setInterval/setTimeout, counting registrations and fires by delay) so the sniff's schedule is
      readable from outside. Two probes. (1) Idle census: with the pane visible and nothing producing
      output, count sniff activity over several seconds. (2) Menu round-trip: drive the pane's REAL select
      menu (e.g. tmux send-keys `/model` + Enter into the agent's own TUI — a `❯` option row plus an
      Esc/Enter hint line), time the type button's `.suggest` pulse appearing, then Esc the menu away and
      time the pulse clearing. Record the run as video.
    expected: >-
      The sniff is event-driven, not polled: NO recurring sniff interval is registered (the old 700ms
      clock is gone from the page's interval census), and a still pane is scanned ZERO times — a scan runs
      only when pane output actually lands (xterm's onWriteParsed), one trailing scan per short burst. The
      real menu still pulses the type button (within a beat of the menu's bytes landing) and the pulse
      clears when the menu closes. Baseline bug-shape: a 700ms setInterval full-buffer scan ticking
      ~1.4×/s forever on a perfectly still terminal.
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
census + WS frames) while exercising the REAL surfaces: an actual agent TUI's select menu for the sniff,
the actual entrance animation for the fit. Zero loss is a still, untouched pane costing zero scans and
zero rehearsal timers — with the pulse and the fit behaving exactly as before.
