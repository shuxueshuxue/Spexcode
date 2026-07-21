---
scenarios:
  - name: terminal-font-size-uses-one-geometry-path
    tags: [frontend-e2e, desktop, backend-api]
    description: >-
      View live sessions, open the real routed Settings page, change terminal font size while their mounted
      terminals are hidden, then return to Sessions. Record typography, WebSocket controls, tmux client size,
      renderer identity, and every browser paint; reload and revisit both sessions.
    expected: >-
      Every hidden terminal changes locally without creating a helper, voting on geometry, or emitting a resize.
      Returning shows the cached renderer and emits one ordinary measured grid request followed by the same
      transaction used for browser resizing. Socket and xterm identity stay mounted, no partial frame paints,
      dashboard chrome does not scale, and reload restores the saved size before first measurement.
---

# terminal-font-size - yatsu

Drive the visible numeric control in Settings and inspect the real terminal/tmux path. Directly mutating xterm
options or localStorage is not evidence that the preference surface and the unified geometry transaction agree.
