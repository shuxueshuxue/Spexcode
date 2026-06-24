---
scenarios:
  - name: activity-line-renders
    description: >-
      Open the dashboard with at least one live WORKING session and look at the top-left session window:
      each row is two lines — Row 1 identity (avatar · name · status · op tally) and Row 2 the worker's own
      live activity summary (its tmux pane title) in a smaller, dimmer font spanning the row width. A row
      with no activity (offline / queued) shows only Row 1. Screenshot it and file with
      `spex yatsu eval session-activity --image <png> --pass`.
    expected: >-
      A working session's row shows its live one-line activity summary on Row 2 — the task it is on,
      distinct from and below its identity line; an inactive/offline row shows no activity line. The
      summary is the worker's own pane title, not a derived label.
    code:
      - spec-cli/src/sessions.ts
      - spec-dashboard/src/SessionWindow.jsx
---
# yatsu.md — session-activity

Product surface, measured by **looking** (YATU): the agent screenshots the rendered session window and
confirms each live row carries its Row-2 activity line (the worker's pane-title self-summary), filing it as
a reading with image evidence and a verdict. The scenario scopes its freshness `code:` to the capture
(`sessions.ts`) and the render (`SessionWindow.jsx`) — not the shared stylesheet — so an unrelated CSS edit
elsewhere doesn't stale this reading.
