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
not an internal probe. Two losses, both about a pane looking wrong the moment a human opens it:

- **on-attach reflow** — the pane re-wrapping from a stale size to the browser size. Zero loss is the
  supervisor holding every warm bridge at the last-known viewer size, so the pane is already correct
  before they look.
- **undersized first frame** — a warm pane connects while still hidden (0×0), so a guessed-size first
  frame would land short and then snap to full when the human looks. Zero loss is the server **deferring**
  that first paint to the client's first resize (drawn at the real visible size), with a bounded fallback
  so a viewer that never resizes is still never blank.
