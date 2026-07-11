---
scenarios:
  - name: push-renders-without-refetch
    description: >
      Open the dashboard in a real browser (worktree vite over a worktree backend), open the session
      panel, and count network requests to /api/graph (excluding the stream). Inject a real board change
      server-side: a session record appearing in the per-user store with a distinct name and an
      awaiting/merge state. Watch for the name to render on the panel, and count refetches while it does.
    expected: >
      The injected session renders on the panel within a few seconds, delivered by the delta stream —
      the /api/graph refetch count during the change is exactly zero, and the board shows the change
      whole (name + review status), never a partial or mixed state.
    tags: [frontend-e2e]
  - name: delta-beats-snapshot
    description: >
      Subscribe to /api/graph/stream?mode=delta directly, read the board-full size, then make a small
      real change (add/remove one session record in the store) and read the next event's size and its
      from/to chain against the held tag.
    expected: >
      A small change arrives as board-delta at a small fraction of the board-full size (measured ~8.6KB
      vs ~570KB), with from matching the held tag; a change burst or precondition violation may arrive
      as board-full instead, but no event ever exceeds the full snapshot's size.
    tags: [backend-api]
---

Measured YATU-style through the running product: a headless Chromium on the real dashboard for the render
scenario (screenshot as evidence), a raw SSE subscription for the wire-size scenario (transcript as
evidence). Neither scenario reads the implementation to decide — the browser's DOM and the bytes on the
stream are the measurement.
