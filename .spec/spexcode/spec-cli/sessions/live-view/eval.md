---
scenarios:
  - name: unwatched-warm-bridge-stays-silent
    tags: [backend-api]
    description: >-
      Measure that the bridge supervisor does NO periodic work for an unwatched session. Through the real
      product surface (the dashboard viewing session A, CDP capturing every WebSocket frame — or the
      equivalent attachViewer/resizeBridge API drive), hold a sized viewer on session A for several
      supervisor ticks (≥40s) while another live-but-quiet session B keeps a hidden (never-sized)
      subscriber. Count the frames B's socket receives and classify them: reconstructed frames carry the
      frame header signature (pen reset + viewport clear, `\x1b[m\x1b]8;;\x1b\\\x1b[H\x1b[2J…`); genuine
      live `%output` does not. Also confirm the keep-alive ping still arrives on cadence, and that tmux's
      window size for B is not being asserted each tick (its geometry stays wherever the last sized viewer
      left it). File with `spex eval add live-view --scenario unwatched-warm-bridge-stays-silent --result <txt>`.
    expected: >-
      B's hidden socket receives ZERO supervisor-driven reconstructed frames across the ticks — no per-tick
      capture, no per-tick broadcast, no refresh-client assert (the old warm-hold path, measured at one
      identical ~3.4KB full frame every reconcile tick per unwatched session while anyone voted, is gone;
      its threat model — windows drifting while unwatched — is already closed by bare-attach-asserts-nothing
      plus neutral clients yielding). The only idle traffic on B's socket is the 10s keep-alive ping;
      genuine `%output` from B's own TUI still flows through untouched, and event-driven repaints
      (re-bind, mode change) remain intact.
  - name: foreign-instance-size-neutrality
    tags: [backend-api]
    description: >-
      Measure the multi-instance shrink that hit the live deploy: a second backend instance (a worktree's
      test `spex serve`) shares the tmux socket, its dashboard's board-load opens HIDDEN (never-sized)
      viewers on every session, and any layout event makes its bridges repaint and assert their own cold
      size — collapsing the terminal a human is watching on the main instance to 120x40, unreclaimable
      (the main bridge's counter-assert is a same-client-size no-op). Run
      `SPEXCODE_TMUX=foreign-$$ npx tsx test/pty-bridge.foreign-instance.ts` (from spec-cli/): TWO real
      bridge instances in separate processes on one scratch socket — instance A with a sized viewer
      (221x63), instance B with only a hidden viewer at the cold default — then two layout events, and
      read the window size tmux reports. File with `spex yatsu eval live-view --scenario
      foreign-instance-size-neutrality --result <txt>`.
    expected: >-
      The watched window stays at the sized viewer's size (the script's final resize, 219x63) — a bridge
      whose viewers never sized it is size-NEUTRAL: its client carries tmux's ignore-size flag, so its
      refresh-client -C cannot move a window while a sized viewer votes, and the foreign instance's client
      list shows the ignore-size flag. The bug path (every bridge client votes, so a viewer-less foreign
      bridge's cold-size assert wins and sticks) must be absent.
  - name: set-size-to-first-frame-is-event-driven
    tags: [backend-api]
    description: >-
      Measure the "visible → full screen" gap: how long from setting a size to the viewer receiving the
      coherent full frame, and whether it converges on the asked size. On a tmux socket, warm a bridge
      through the real API (attachViewer at a first size), then — with the bridge already up (the warm
      case, which is the real path when a hidden pane becomes visible) — call resizeBridge to a new size
      (e.g. 100×30) and time it to the viewer's next frame. Confirm (1) that latency is event-level (a few
      ms, well under the ~320ms the old pty-resize + geometry-poll path cost), (2) tmux's window converged
      to exactly the asked size (the frame is drawn on the settled geometry, no half-frame), and (3) no
      polling is involved — the frame is driven by tmux's %layout-change + capture-pane reply, not a
      geometry read loop. File with `spex yatsu eval live-view --scenario
      set-size-to-first-frame-is-event-driven --result <txt>`.
    expected: >-
      A warm resize produces the full frame in ~5–20ms (event-driven: refresh-client -C sets the size,
      %layout-change confirms convergence, a bounded capture-pane seeds the frame), an order of magnitude
      under the ~320ms polling path it replaces. tmux's window equals the asked size when the frame lands,
      so the screen is coherent at the converged geometry — never a mid-flight half-frame. The frame is one
      clear+home + the real pane rows (with escapes/UTF-8 intact), and live pane output continues to arrive
      as %output events after it.
  - name: attach-seed-carries-pre-attach-history
    tags: [backend-api]
    description: >-
      Measure that the wheel can reach output from BEFORE the client attached (the "wheel scrolls real
      history" contract, in control mode). On a tmux socket, print far more lines than the visible screen
      holds (e.g. 1200 lines into a 24-row pane) so most scroll into tmux history BEFORE any bridge exists.
      Then attach a viewer through the real API (attachViewer with a size) and inspect its first frame: it
      must carry the visible tmux view without seeding a browser-owned history buffer. Send wheel-up frames
      through the same WebSocket/API path the dashboard uses
      and confirm tmux enters copy-mode, `#{scroll_position}` increases, and the viewer receives repainted
      older rows from the copy-mode viewport reconstructed from tmux's own scroll position, not the bottom
      pane screen that plain `capture-pane` would return. While still scrolled in copy-mode, produce fresh
      pane output and confirm it does not paint over that frozen viewport; mode repaint, not `%output`, owns
      the screen until copy-mode exits. Then send wheel-down frames and confirm the copy-mode view moves
      back toward the bottom. Finally detach fully and re-attach (a fresh bridge) and confirm history is still
      reachable through the same tmux-owned wheel path. File with `spex yatsu
      eval live-view --scenario attach-seed-carries-pre-attach-history --result <txt>`.
    expected: >-
      Wheel-up on a NORMAL-screen pane enters tmux copy-mode and increases `#{scroll_position}` while the
      viewer receives a coherent repaint of older tmux history from the same scroll window tmux reports;
      live pane output is held back while that copy-mode viewport is active, and wheel-down moves that same tmux view back
      toward the bottom. The browser does not expose or scroll an independent xterm history buffer, and no
      mouse bytes are littered into the shell prompt. A full-screen alternate-screen TUI with SGR mouse reports
      still gets forwarded wheel reports, so the app scrolls itself.
  - name: scroll-osc8-hyperlink-no-underline-leak
    tags: [backend-api]
    description: >-
      Measure the "whole screen goes underlined when I scroll" regression through the real bridge surface. On
      a tmux socket, print a line carrying an OSC 8 hyperlink whose closing ST lands at the row's end
      (`printf '\033]8;;https://example/x\033\\LINK\033]8;;\033\\\n'` — the same shape Claude Code emits for a
      URL, which xterm renders underlined), then push it up into tmux history behind filler. Attach a viewer
      through the real API (attachViewer) and send wheel-up frames (forwardWheel, the dashboard's exact path)
      until copy-mode repaints the link row from history. Capture the bytes the bridge broadcasts and inspect
      every OSC 8 close (`\x1b]8;;`): each must be properly ST/BEL terminated, never a bare `\x1b]8;;` cut off
      at a line boundary. File with `spex yatsu eval live-view --scenario
      scroll-osc8-hyperlink-no-underline-leak --result <txt>`.
    expected: >-
      The repainted copy-mode frame carries the hyperlink's close with its `\x1b\\` (ST) intact — ZERO
      truncated closes — so xterm terminates the link and the underline stays on the link text alone, not the
      rest of the screen. The bug path (running capture-reply BODY lines through the DCS-exit strip, which eats
      a trailing `\x1b\\`) must be absent: capture bodies are pushed byte-verbatim, and each frame additionally
      leads with an SGR reset + OSC 8 close so no open-hyperlink state survives the viewport clear.
  - name: scroll-updown-no-doubled-redraw
    tags: [backend-api]
    description: >-
      Measure the "bottom garbles when I scroll up then back down" regression through the real bridge. Run an
      Ink-style redrawer in a tmux pane that reproduces the real pane shape — the cursor parked on the input
      line ABOVE trailing content (a separator + hint), redrawing each frame RELATIVE to that parked cursor
      (up to the frame top, clear to end, rewrite). Attach a viewer through the real API (attachViewer), send
      wheel-up frames (forwardWheel) to enter copy-mode and freeze while the pane keeps advancing, then
      wheel-down past the bottom to exit copy-mode and resume live output onto the re-seed. Replay the bytes the
      bridge broadcast through a small VT emulator and count how many copies of the frame's single marker line
      survive on the final screen. File with `spex yatsu eval live-view --scenario
      scroll-updown-no-doubled-redraw --result <txt>`.
    expected: >-
      Exactly ONE copy of the frame's marker on the final screen — the copy-mode-exit re-seed restored the
      pane's real cursor position (`\x1b[y;xH` from cursor_x/cursor_y), so the TUI's next cursor-relative redraw
      erased its previous frame from the right row. The bug path (a re-seed that leaves the cursor at the body's
      end) doubles the frame — the old and new bottom UI stacked — and must be absent.
  - name: reconnect-reseed-no-doubled-redraw
    tags: [backend-api]
    description: >-
      Measure the SAME doubled-bottom glitch as scroll-updown, but from the trigger a fresh session hits on a
      deploy WITHOUT scrolling: a reconnect / refit re-seed. Run the Ink-style relative redrawer (cursor parked
      above trailing content) in a tmux pane, attach a viewer through the real API, and — while it is mid-render
      — force a bare full-frame re-seed at the SAME size (resizeBridge(cols, rows, full=true), which is what a
      viewer reconnect / unsolicited layout-change drives). The pane gets no SIGWINCH, so the TUI keeps doing
      cursor-relative redraws onto the re-seed. Replay the broadcast through the VT emulator and count copies of
      the frame's single marker. File with `spex yatsu eval live-view --scenario
      reconnect-reseed-no-doubled-redraw --result <txt>`.
    expected: >-
      Exactly ONE copy of the marker — the re-seed restored the pane's real cursor, so the next relative redraw
      erased its previous frame correctly even with no scroll and no resize. The bug path (a re-seed that leaves
      the cursor at the body's end) doubles the frame, which is why every fresh session on the deploy garbled at
      the bottom; it must be absent.
  - name: output-preserves-utf8-wide-chars
    tags: [backend-api]
    description: >-
      Measure that wide characters survive the live %output byte path (the regression that shattered the
      display). On a tmux socket, attach a control-mode bridge through the real API, then flood the pane with
      MANY lines of CJK + box-drawing + emoji (e.g. `星★号😀笑脸└─┘中文🀄🎉αβγ` ×thousands) — enough bytes that
      the multi-byte characters straddle node-pty's read boundaries, the exact condition that used to corrupt
      them. Capture the bytes the bridge broadcasts to a viewer, decode as UTF-8, and count U+FFFD + check the
      payload survived. File with `spex yatsu eval live-view --scenario output-preserves-utf8-wide-chars
      --result <txt>`.
    expected: >-
      The broadcast bytes decode to ZERO U+FFFD and every flooded payload copy is intact — because the bridge
      parses the stream as BYTES end-to-end (node-pty gives raw Buffers, lines split on the newline byte,
      %output un-escaped at the byte level and forwarded raw, no string round-trip). A path that decodes
      node-pty chunks to a string first shatters any wide char split across two reads into a U+FFFD; that path
      must be absent.
  - name: hidden-connect-defers-undersized-first-paint
    tags: [backend-api]
    description: >-
      Measure the undersized first frame a hidden (0×0) connect used to receive. On a tmux socket, warm a
      bridge through the real API (attachViewer spawns the shared client, resizeBridge sets a "prewarm"
      size). Then attach a SECOND viewer with NO initial size — the warm-and-hidden dashboard connect — via
      attachViewer, and count the pane bytes it receives. Probe three things: (1) over ~300ms BEFORE any
      resize it must receive ZERO frames — the first paint is driven PURELY by the first resize, with no timer
      fallback that would paint on its own; (2) send the client's first resize (resizeBridge to the real
      visible size, e.g. 214×57) and confirm it now receives the deferred first frame and tmux's window
      converges to that size; (3) a SEPARATE viewer that never resizes receives NOTHING — fail-loud, no timer,
      because a pane no one makes visible is a pane no one looks at and so needs no frame. File with `spex
      yatsu eval live-view --scenario hidden-connect-defers-undersized-first-paint --result <txt>`.
    expected: >-
      The hidden, no-size viewer receives NO pane bytes until its first resize — the server draws no
      undersized prewarm frame into a still-hidden buffer (first-visible, not first-connect), and no timer
      ever paints one either. Its first resize draws the one first frame at the real visible size (the window
      converges to it; the viewer receives bytes). A viewer that never resizes stays blank forever — the
      first-paint path holds zero timers, so a frame arrives only as the pure consequence of a resize event.
---
# eval.md — live-view

The live terminal's product surface is measured through the **real bridge API** the dashboard drives
(`attachViewer` / `resizeBridge` over the per-session WebSocket) plus tmux's own reported window size —
not an internal probe. The losses, about a pane behaving wrong the moment a human opens it:

- **unwatched idle cost** — the supervisor doing periodic work for sessions nobody is looking at. Zero
  loss is an unwatched warm bridge that is completely silent (no per-tick assert/capture/broadcast; a
  hidden pane's idle traffic is the keep-alive ping alone), with window geometry owned by sized viewers
  and simply kept between them.
- **undersized first frame** — a warm pane connects while still hidden (0×0), so a guessed-size first
  frame would land short and then snap to full when the human looks. Zero loss is the server **deferring**
  that first paint **purely** to the client's first resize (drawn at the real visible size), with **no timer
  fallback** — a pane that never resizes is one no one makes visible, so it needs no frame, keeping the
  first-paint path event-driven and zero-timer just like the resize convergence.
- **visible → full-screen latency** — the gap from a pane becoming visible (its size set) to its coherent
  full frame. The control-mode boundary makes this **event-driven and timer-free** — `refresh-client -C` sets
  the size, the guaranteed `%layout-change` confirms convergence, a bounded `capture-pane` seeds the frame — so
  zero loss is a few ms on the converged geometry, an order of magnitude under the ~320ms the old poll cost.
- **wide-character integrity** — `%output` passes high bytes through raw, so decoding them as anything but
  UTF-8 truncates every CJK / box-drawing / emoji character to one wrong byte (the regression that shattered
  the display). Zero loss is a wide-character line round-tripping through the real bridge byte-for-byte.
- **history reach** — with control mode streaming only post-attach `%output`, the wheel would reach nothing
  from before the client attached. Zero loss is the pane's real history reachable through tmux itself:
  a normal-screen pane scrolls tmux copy-mode and repaints that view; a full-screen TUI receives forwarded
  wheel mouse reports so the app scrolls itself.
