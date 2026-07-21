---
scenarios:
  - name: resize-has-one-compositor
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Through the running dashboard in a real browser, view a busy scratch tmux session whose program emits
      unrelated synchronized spinner ticks while responding to SIGWINCH later through several paired and
      unpaired redraw writes. Record the WebSocket bytes, browser resize/geometry timeline, whole-session
      video, and every painted browser frame while shrinking the terminal from a large viewport to a small one.
    expected: >-
      The old painted frame remains until one fast refreshed native-client transaction commits the new grid.
      Geometry aftershocks inside the fixed boundary land in one later transaction, with any clear and delayed
      redraw parsed under one browser hold. No captured frame is blank, partially swept top-to-bottom, or an eager
      xterm reflow of the old buffer at the new grid; no control observer, second terminal, quiet-completion guess,
      snapshot layer, or application-specific rule exists. After the boundary ordinary output is undelayed.
  - name: unsynchronized-resize-is-bounded
    tags: [backend-api]
    description: >-
      Resize a scratch TUI that never emits DEC 2026, deliberately clears, waits 120 ms, draws its full final
      grid, then resumes ordinary output. Capture exact viewer chunks and elapsed resize time.
    expected: >-
      The intermediate clear and delayed final grid occupy the same transaction-marked viewer frame, so only the
      final grid paints. The fixed geometry boundary, not a quiet-period guess, closes that frame; the same path
      handles paired and unpaired applications and capability detection cannot fork the lifecycle.
  - name: warm-tab-switch-paints-immediately
    tags: [frontend-e2e, desktop]
    description: >-
      View two live sessions through the real dashboard, switch away from each so both retain a browser
      buffer, then record every browser paint while repeatedly switching between them.
    expected: >-
      The first visible paint already contains the fitted xterm's cached pixels. No empty renderer,
      undersized first layout, renderer replacement, or socket reconnect appears. Native reattach happens
      behind the cached frame and replaces it only with a complete native redraw; hidden layers remain
      visually hidden and non-interactive.
  - name: background-return-resyncs-current-screen
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      View a live tmux pane that updates a visible sequence number several times per second, move to another
      browser tab long enough for the dashboard page to be suspended, then return while recording terminal
      text, WebSocket frames, helper lifecycle, and every browser paint.
    expected: >-
      Browser-page visibility participates in the same viewer lifecycle as dashboard-session visibility.
      While the page is hidden it retains the browser terminal and socket but holds no native helper and
      receives no continuing pane deltas. Return exposes the cached pixels immediately, then one native attach
      replaces them with the current complete tmux screen. The user never watches queued historical deltas
      fast-forward to the present, and no second replay, capture, or page-specific terminal path exists.
  - name: cold-visible-attach-is-atomic
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      Route directly to a busy live session that has never been visible in this dashboard. Its pane already
      contains a full screen and appends small cursor/spinner updates throughout native attach. Record helper
      creation, WebSocket bytes, and every browser paint from navigation through the first terminal frame.
    expected: >-
      The already-open socket creates one native helper at the measured visible grid. A short wait for native
      attach is allowed, but its first binary batch contains terminal setup through one forced complete tmux
      repaint; it never keeps only a trailing spinner transaction. Later geometry aftershocks are separately
      coalesced at the fixed boundary. The
      first terminal content is one complete rendition: no synthetic capture,
      progressive top-to-bottom sweep, standalone clear, eager wrong-size reflow, or repeated full-screen flash.
      The rendition contains the pane only: no tmux status row or other client chrome, and an N-row browser
      grid gives the pane all N rows.
  - name: multiple-viewers-fit-all
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-cli/test/pty-bridge.visibility-lifecycle.ts
    description: >-
      Open two simultaneous visible dashboard viewers for one live session at different terminal sizes, inspect
      each browser screen against its host and the shared native tmux client, then hide the narrower viewer.
    expected: >-
      The shared client uses the smallest visible rows and columns, and every viewer receives that grid commit
      even when the helper size is unchanged. Neither browser clips its right or bottom cells. In a wider or
      taller host the shared grid is bottom-left aligned, leaving any ordinary remainder above or to the right
      while its last row meets the input strip. Hiding the limiting viewer resizes the same helper to the
      remaining viewer's larger grid; hidden viewers cast no size vote and no second helper exists.
  - name: synchronized-output-is-atomic
    tags: [frontend-e2e, desktop]
    description: >-
      In a real browser terminal, apply a large bridge-owned geometry frame containing a clear, enough bytes
      for xterm's write buffer to time-slice parsing, and several native tmux DEC 2026 pairs. Separately stream
      an ordinary native synchronized transaction. Observe xterm render events and every painted frame.
    expected: >-
      The bridge-owned frame's inner tmux end markers do not close its outer hold: resize and the complete parse
      produce one final paint even across xterm write slices. Outside that frame, the ordinary stream's native
      markers retain their normal behavior. No DOM latch or second renderer covers intermediate states.
  - name: hidden-subscription-holds-no-pty
    tags: [backend-api]
    description: >-
      Open hidden terminal sockets for several live sessions, resize the hidden browser layers, then make one
      viewer visible and hide it again while inspecting helper processes, tmux clients, and pane geometry.
    expected: >-
      Hidden sockets and xterms remain mounted but create no helper, receive no pane pixels, and do not resize
      tmux. The first visible viewer creates exactly one native helper at the measured size; hiding the last
      visible viewer releases it without closing the socket or clearing the browser buffer. No observer exists.
  - name: helper-isolates-pty-masters
    tags: [backend-api]
    description: >-
      Create four visible bridges on one scratch tmux socket through the real bridge API, inspect each
      helper and tmux client fd table, kill one helper, and continue producing output on the other sessions.
    expected: >-
      The backend owns no PTY master, every helper owns only its own master, and tmux clients inherit no
      sibling master. Killing one helper detaches only its session's native client; the other panes and the
      shared tmux server remain responsive.
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
PTY ownership, visibility-scoped lifetime, real tmux navigation, durable subscriptions, and UTF-8 integrity.
