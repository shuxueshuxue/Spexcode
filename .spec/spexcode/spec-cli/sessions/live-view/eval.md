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
      buffer, then record every browser paint while repeatedly switching between them — both quickly
      (inside the bounded linger window) and again after the helper release.
    expected: >-
      A switch-back inside the linger window is seamless continuation: the buffer kept consuming the native
      stream while hidden, so the first visible paint is already the current screen and no reattach, repaint
      transaction, empty renderer, undersized first layout, renderer replacement, or socket reconnect
      appears — output simply continues in place. Past the window the first visible paint still contains the
      cached pixels, and native reattach happens behind that frame, replacing it only with a complete native
      redraw. Hidden layers remain visually hidden and non-interactive.
  - name: background-return-resyncs-current-screen
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      View a live tmux pane that updates a visible sequence number several times per second, move to another
      browser tab past the bounded linger window (long enough for the dashboard page to be suspended), then
      return while recording terminal text, WebSocket frames, helper lifecycle, and every browser paint.
    expected: >-
      Browser-page visibility participates in the same viewer lifecycle as dashboard-session visibility.
      Within the linger window the hidden page keeps the helper and its buffer keeps consuming the live
      stream, so an early return continues output in place. Once the window elapses the helper is released:
      the page retains the browser terminal and socket but holds no native helper and receives no continuing
      pane deltas. A later return exposes the cached pixels immediately, then one native attach replaces them
      with the current complete tmux screen. The user never watches queued historical deltas fast-forward to
      the present, and no second replay, capture, or page-specific terminal path exists.
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
    test: spec-dashboard/test/terminal-multi-viewer.e2e.mjs
    description: >-
      Open two simultaneous visible dashboard viewers for one live session at different terminal sizes, inspect
      each browser screen and native tmux client, then close each viewer independently.
    expected: >-
      Each visible WebSocket owns one real client at its measured grid. With `window-size latest`, the
      most recently ACTIVE client owns the application grid: when the small viewer interacts it takes
      the window and sees the whole pane (no cropped corner it cannot escape), and the idle large
      viewer letterboxes that grid — content complete on both. Closing either socket immediately
      removes only its client, and tmux recomputes naturally from the remaining client without a
      bridge-owned size vote.
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
    test: spec-cli/test/pty-bridge.visibility-lifecycle.ts
    description: >-
      Open hidden terminal sockets for several live sessions, resize hidden browser layers, then make two viewers
      of one session visible and hide them independently across the bounded linger window while inspecting helper
      processes, tmux clients, and pane geometry.
    expected: >-
      Hidden sockets and xterms create no helper, receive no pane pixels, and do not resize tmux. Each visible
      viewer creates exactly one native helper at its own measured size. Hiding one viewer lingers only its own
      client and buffer; an unchanged return resumes it without repaint, while expiry releases it without
      touching a visible sibling. A never-visible subscription receives no pixels. Closing a socket bypasses
      linger and removes its client immediately; a missing heartbeat pong does the same within the deadline.
  - name: helper-isolates-pty-masters
    tags: [backend-api]
    description: >-
      Create four visible viewers on one scratch tmux socket through the real bridge API, inspect each
      helper and tmux client fd table, kill one helper, and continue producing output on the other viewers.
    expected: >-
      The backend owns no PTY master, every helper owns only its own master, and tmux clients inherit no
      sibling master. Killing one helper detaches only its viewer's native client; sibling viewers and the
      shared tmux server remain responsive.
  - name: attach-and-rebind-replay-current-screen
    tags: [backend-api]
    description: >-
      Produce normal-screen history and a live alternate-screen display before any viewer exists. Attach two
      visible viewers at the same size, then kill and restore one viewer's helper while both sockets stay open.
    expected: >-
      Native attach/refresh supplies each blank xterm with the current complete tmux screen through its own raw
      client stream. Restoring one helper repaints only its viewer without a socket reconnect or disturbing its
      sibling; neither stream uses a capture splice, doubled bottom UI, or stale cursor-relative redraw.
  - name: dead-websocket-reaps-native-client
    tags: [backend-api]
    test: spec-cli/test/terminal-socket-lifecycle.ts
    description: >-
      Connect a real terminal WebSocket to a scratch tmux session, claim a visible grid, then emulate a half-open
      browser that receives server pings but never answers pong and never produces a transport close event.
    expected: >-
      The visible socket initially owns exactly one native client. The server heartbeat deadline removes the
      subscription and helper without waiting for `close`; the tmux client count returns to zero within the
      derived dead window plus scheduling slack, so its old geometry cannot constrain a later viewer.
  - name: viewport-clips-no-phantom-scrollbar
    tags: [frontend-e2e, desktop]
    description: >-
      Through the running dashboard, view a live session terminal and inspect the pane viewport's computed
      overflow, including under a fractional device-pixel ratio where xterm's content height can overshoot
      the host by a sub-pixel. Screenshot the terminal's right edge.
    expected: >-
      The pane viewport clips on both axes: its computed overflow is hidden, so no themed browser scrollbar
      can float over the terminal's right edge under any DPR or geometry overshoot. Wheel input still travels
      to the real tmux client — no browser scroll region exists to compete with tmux's own scrolling. The
      grid sits in normal flow: the fractional fit remainder rests below the last row (a plain terminal's
      natural bottom strip), not relocated above the first row by any bottom-pinning alignment.
  - name: scroll-return-resumes-live-tail
    tags: [frontend-e2e, desktop]
    description: >-
      Through the real dashboard, view a live claude TUI pane whose status line ticks. Wheel up into
      history and back down across many rounds — clean notches, momentum micro-delta gestures with
      sub-quantum tails, gentle landings that stop the instant the view reads as bottomed — while the
      pointer keeps drifting over the terminal between gestures (a human hand never holds still).
      Record the rendered terminal and the pane truth (capture-pane) across each round.
    expected: >-
      The bridge-owned contract: wheel reports reach the TUI (its own scrolled view engages and its
      indicator appears), the return travels symmetrically, and pointer DRIFT alone never arms a
      stall (motion is filtered — hover produces zero reports). A residual status-line stall after
      actual wheeling is claude's DOCUMENTED upstream TUI defect (mouse input pauses its pinned-line
      repaint until a keystroke or content change) — file it as such, not as a bridge regression;
      the pane-truth capture must show whether the stall lives in the pane (upstream) or only in the
      browser (ours).
  - name: wheel-uses-real-tmux-client
    tags: [backend-api]
    description: >-
      Through the dashboard wheel path, scroll a normal shell with pre-attach history AND a full-screen
      TUI that requests SGR mouse input, then return each to its live bottom.
    expected: >-
      tmux's default routing decides: the shell pane enters tmux copy-mode (history produced before
      attach is reachable, the return exits at the bottom) while the mouse-owning TUI receives its
      own wheel events and scrolls its internal view. The browser has no independent scrollback,
      scrollbar, or pane-mode capture/reconstruction path.
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
