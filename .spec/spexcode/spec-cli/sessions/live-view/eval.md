---
scenarios:
  - name: resize-has-one-compositor
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Through the running dashboard in a real browser, view a scratch tmux session whose program responds
      to SIGWINCH after a deliberate delay: first issue an unwrapped full clear, wait again, then write a
      terminal-sized final grid inside DEC synchronized-output markers. Record the WebSocket bytes, browser
      resize/geometry timeline, whole-session video, and every painted browser frame while shrinking the
      terminal from a large viewport to a small one.
    expected: >-
      The post-resize socket stream is the native tmux client rendition: it contains no SpexCode
      reconstructed-frame header and no application ED2/scroll-clear exposed as a standalone browser update.
      For a pane that demonstrated synchronized output, the next post-resize BSU/ESU is the measured barrier
      and the socket resumes with one final native-client refresh. No captured browser frame is blank,
      partially swept top-to-bottom, or an eager xterm reflow of the old buffer at the new grid. The old
      painted frame remains until grid commit and final bytes become one browser paint.
  - name: unsynchronized-resize-is-bounded
    tags: [backend-api]
    description: >-
      Resize a scratch TUI that never emits DEC 2026, deliberately clears, waits 120 ms, draws its full final
      grid, then resumes ordinary output. Capture exact viewer chunks and elapsed resize time.
    expected: >-
      The intermediate clear never reaches the viewer. A 160 ms quiescence window or 400 ms ceiling requests
      one complete native tmux refresh containing the final grid, after which ordinary output resumes. The
      compatibility path remains bounded and is replaced by the semantic event path once a pane emits DEC 2026.
  - name: warm-tab-switch-paints-immediately
    tags: [frontend-e2e, desktop]
    description: >-
      Let hidden live-session terminals prewarm through the real dashboard, then record every browser paint
      while switching into one session and repeatedly switching between two sessions.
    expected: >-
      The first visible terminal paint already contains the warm xterm buffer at the fitted panel size. No
      empty renderer, undersized first layout, first-visible resize, renderer replacement, socket reconnect,
      or tmux reattach appears in the switch timeline. Hidden owner terminals follow panel resizes and settle
      before activation while all hidden layers remain visually hidden and non-interactive.
  - name: synchronized-output-is-atomic
    tags: [frontend-e2e, desktop]
    description: >-
      In a real browser terminal, send a DEC 2026 synchronized-output transaction containing a clear and a
      large multi-chunk redraw with delays between chunks. Observe xterm render events and record every
      painted frame from begin through end.
    expected: >-
      No intermediate clear or partial grid is painted while the transaction is open; one complete final
      grid appears when it closes. A missing end marker fails open on the terminal engine's bounded safety
      timeout rather than freezing the renderer forever.
  - name: hidden-helper-stays-warm-and-size-neutral
    tags: [backend-api]
    description: >-
      Open hidden terminal sockets for several live sessions, let their panes produce output, then make one
      session visible and switch repeatedly between sessions while inspecting helper identity, tmux client
      flags, pane geometry, and time to first already-buffered pixels.
    expected: >-
      Every live socket keeps the same helper and native tmux client across tab switches, and hidden xterm
      buffers continue receiving output. Switching shows terminal content immediately with no reattach or
      pane replay. With no prior size owner, the first hidden helper pre-sizes the pane at final panel geometry;
      a later hidden helper detects that owner, carries ignore-size, and cannot change its watched geometry.
  - name: helper-isolates-pty-masters
    tags: [backend-api]
    description: >-
      Create four visible bridges on one scratch tmux socket through the real bridge API, inspect each
      helper and tmux client fd table, kill one helper, and continue producing output on the other sessions.
    expected: >-
      The backend owns no PTY master, every helper owns only its own master, and tmux clients inherit no
      sibling master. Pipe-only barrier observers own no PTY. Killing one helper detaches only its session's
      raw client/observer pair; the other panes and the shared tmux server remain responsive.
  - name: attach-and-rebind-replay-current-screen
    tags: [backend-api]
    description: >-
      Produce normal-screen history and a live alternate-screen display before any viewer exists. Attach a
      visible viewer, add a second viewer at the same size, then kill and restore the shared helper while
      both sockets stay open.
    expected: >-
      Native attach/refresh supplies each blank xterm with the current complete tmux screen through the same
      raw stream; helper restoration updates both existing subscriptions without a socket reconnect,
      capture splice, doubled bottom UI, or stale cursor-relative redraw.
  - name: wheel-uses-real-tmux-client
    tags: [backend-api]
    description: >-
      Through the dashboard wheel path, scroll a normal shell with pre-attach history and a full-screen TUI
      that owns SGR mouse input, then return the shell to its live bottom.
    expected: >-
      tmux enters and renders its own copy-mode for the shell, including history produced before attach,
      while the TUI receives its own wheel events. The browser has no independent scrollback or scrollbar,
      and no pane-mode capture/reconstruction path is involved.
  - name: output-preserves-utf8-wide-chars
    tags: [backend-api]
    description: >-
      Flood a real visible bridge with CJK, box-drawing, emoji, and Greek text across many PTY reads, capture
      the exact viewer output, and decode it as UTF-8.
    expected: >-
      The stream contains zero replacement characters and the payload copies remain intact across helper
      and WebSocket boundaries.
---
# eval.md - live-view

The loss signal is visual first. The resize scenario is accepted only from the real dashboard with video,
per-frame images or hashes, and a WebSocket/geometry timeline; network ordering without pixels is not proof
of a non-flashing terminal. Backend probes support the architectural invariants: one compositor, isolated
PTY ownership, warm geometry ownership, real tmux navigation, durable subscriptions, and UTF-8 integrity.
