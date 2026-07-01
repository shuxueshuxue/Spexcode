---
scenarios:
  - name: warm-bridge-pre-sized-no-reflow
    tags: [backend-api]
    description: >-
      Measure the on-attach reflow through the real bridge surface. Seed two live sessions on a tmux
      socket at the cold default (120x40). Start the supervisor and let it pre-warm both, then have ONE
      viewer attach and fit to a browser size (e.g. 214x57) via the real path (attachViewer + resizeBridge,
      the same calls the dashboard WebSocket drives). Poll tmux `#{window_width}x#{window_height}` for the
      OTHER, unwatched session across one supervisor tick. ZERO loss = it converges to the viewer size
      off-screen, so a later attach to it sends a size that already matches and tmux re-wraps nothing.
      File with `spex yatsu eval live-view --scenario warm-bridge-pre-sized-no-reflow --result <txt>`.
    expected: >-
      The unwatched warm bridge's tmux window moves from the cold default to the last-known viewer size
      WITHOUT any viewer ever attaching to it; a viewer opening it afterward finds the pane already at its
      size — the open-time fit is a no-op, so there is no visible cols/rows reflow. A watched session stays
      put across ticks (no thrash), since its pre-size equals its own recorded fit.
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
      must carry the visible tail. Send wheel-up frames through the same WebSocket/API path the dashboard uses
      and confirm tmux enters copy-mode, `#{scroll_position}` increases, and the viewer receives repainted
      older rows from tmux's current view. Then send wheel-down frames and confirm the copy-mode view moves
      back toward the bottom. Finally detach fully and re-attach (a fresh bridge) and confirm history is still
      reachable through the same tmux-owned wheel path. File with `spex yatsu
      eval live-view --scenario attach-seed-carries-pre-attach-history --result <txt>`.
    expected: >-
      Wheel-up on a NORMAL-screen pane enters tmux copy-mode and increases `#{scroll_position}` while the
      viewer receives a coherent repaint of older tmux history; wheel-down moves that same tmux view back
      toward the bottom. The browser does not scroll an independent xterm buffer, and no mouse bytes are
      littered into the shell prompt. A full-screen alternate-screen TUI still gets forwarded SGR wheel reports
      so the app scrolls itself.
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
# yatsu.md — live-view

The live terminal's product surface is measured through the **real bridge API** the dashboard drives
(`attachViewer` / `resizeBridge` over the per-session WebSocket) plus tmux's own reported window size —
not an internal probe. The losses, about a pane behaving wrong the moment a human opens it:

- **on-attach reflow** — the pane re-wrapping from a stale size to the browser size. Zero loss is the
  supervisor holding every warm bridge at the last-known viewer size, so the pane is already correct
  before they look.
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
