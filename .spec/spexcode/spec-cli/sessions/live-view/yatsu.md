---
scenarios:
  - name: warm-bridge-pre-sized-no-reflow
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
---
# yatsu.md — live-view

The live terminal's product surface is measured through the **real bridge API** the dashboard drives
(`attachViewer` / `resizeBridge` over the per-session WebSocket) plus tmux's own reported window size —
not an internal probe. The loss this scenario scores is the **on-attach reflow**: the user opening a
session and watching the pane re-wrap from a stale size to their browser size. Zero loss is the supervisor
holding every warm bridge at the last-known viewer size, so the pane is already correct before they look.
