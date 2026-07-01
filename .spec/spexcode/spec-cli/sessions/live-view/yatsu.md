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
      must carry deep pre-attach history, not just the visible screen. Then call resizeBridge to a new size
      and confirm the resize frame re-seeds ONLY the visible screen (no thousands-of-lines re-flush). Finally
      detach fully and re-attach (a fresh bridge) and confirm history is seeded again. File with `spex yatsu
      eval live-view --scenario attach-seed-carries-pre-attach-history --result <txt>`.
    expected: >-
      The first frame of a (re)attach contains hundreds/thousands of the pre-attach lines (a bounded
      capture-pane -S over tmux's recent scrollback), reaching back to the earliest history and ending at the
      current visible tail — so on a NORMAL-screen pane those lines write into the browser terminal and the
      native wheel scrolls genuine pre-attach output. (A full-screen alternate-screen TUI keeps no such
      scrollback, so its wheel is forwarded to the app instead — see output-preserves-utf8-wide-chars's
      sibling behaviour.) A subsequent resize re-seeds only the visible screen (≤ the row count, no history
      re-flush), and the clear is viewport-only so it never wipes the seeded scrollback. A fresh bridge on
      re-attach re-seeds history.
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
      attachViewer, and count the pane bytes it receives. Probe three things: (1) over ~150ms BEFORE any
      resize it must receive ZERO frames; (2) send the client's first resize (resizeBridge to the real
      visible size, e.g. 214×57) and confirm it now receives the deferred first frame and tmux's window
      converges to that size; (3) a SEPARATE viewer that never resizes still receives a frame within the
      bounded fallback. File with `spex yatsu eval live-view --scenario
      hidden-connect-defers-undersized-first-paint --result <txt>`.
    expected: >-
      The hidden, no-size viewer receives NO pane bytes until its first resize — the server draws no
      undersized prewarm frame into a still-hidden buffer (first-visible, not first-connect). Its first
      resize draws the one first frame at the real visible size (the window converges to it; the viewer
      receives bytes). A viewer that never resizes still receives one fallback frame, so a non-dashboard
      pane is never left blank.
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
  that first paint to the client's first resize (drawn at the real visible size), with a bounded fallback
  so a viewer that never resizes is still never blank.
- **visible → full-screen latency** — the gap from a pane becoming visible (its size set) to its coherent
  full frame. The control-mode boundary makes this **event-driven and timer-free** — `refresh-client -C` sets
  the size, the guaranteed `%layout-change` confirms convergence, a bounded `capture-pane` seeds the frame — so
  zero loss is a few ms on the converged geometry, an order of magnitude under the ~320ms the old poll cost.
- **wide-character integrity** — `%output` passes high bytes through raw, so decoding them as anything but
  UTF-8 truncates every CJK / box-drawing / emoji character to one wrong byte (the regression that shattered
  the display). Zero loss is a wide-character line round-tripping through the real bridge byte-for-byte.
- **history reach** — with control mode streaming only post-attach `%output`, the wheel would reach nothing
  from before the client attached. Zero loss is the pane's real history reachable by whichever path the pane
  owns: a normal-screen pane's tmux scrollback seeded (bounded `capture-pane -S`) into xterm's own buffer for
  the native wheel; a full-screen TUI (which keeps no such scrollback) scrolled by forwarding the wheel to the
  app. A resize re-seeds only the visible screen (no re-flush).
