---
scenarios:
  - name: cmd-slash-opens-sessions-first
    description: >
      Through the running dashboard in a real browser, open the session console (Enter) so the session board
      is the active surface. Press ⌘+/ (mac) or Ctrl+/ (win/linux). The SAME search palette the board's `/`
      opens must appear, floating ABOVE the session board (not hidden behind it). Type a query that matches
      both a live session and a spec node (e.g. a word in a session's headline that is also a node name).
      Screenshot the open palette over the session board and the ranked result rows.
    expected: |
      ⌘/Ctrl+/ opens the one shared palette over the session board — same input + ranked rows as the board's
      `/`, never a second component, rendered above the board (z-index over .si-backdrop). With the query
      matching both planes, a SESSION row ranks at the TOP (the session plane is boosted to lead the
      interleave), with the matching spec node and any issues/scenarios reachable below — every plane still
      visible, sessions first. Esc / backdrop click closes it back to the session board.
    related:
      - spec-dashboard/src/SpecSearch.jsx
      - spec-dashboard/src/App.jsx
  - name: pick-routes-session-vs-node
    description: >
      With the ⌘/Ctrl+/ palette open over the session board, first pick a SESSION result (click or Enter on a
      highlighted session row) and watch where you land. Reopen the palette and this time pick a NON-session
      result (a spec node). Watch whether the session view stays or closes and where focus lands. Screenshot
      after each pick.
    expected: |
      Picking a SESSION opens/switches to that session's tab in the console — you stay on the session board,
      now on the chosen session. Picking a NON-session (spec node / issue / scenario) CLOSES the session view
      and jumps to that node on the node graph, focused and revealed. The same routing also works from the
      board's `/` (where closing the session view is simply a no-op), so the branch is shared, not forked.
    related:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SessionInterface.jsx
---

# session-board-search — yatsu

Measure through the **real running dashboard in a browser**, YATU-style: open the session console with
`Enter`, fire the actual ⌘/Ctrl+/ chord, and drive the real palette — never a direct call into `SpecSearch`'s
`rank`/`onPick` and never an internal helper chosen to make the proof easy. The loss is the two contracts
this node owns on top of the shared [[shared-ranker]] palette: **sessions lead** the ranking when opened from
the session board (while every other plane stays visible below), and a **pick routes by kind** — a session to
its tab, a non-session by closing the board and jumping to the node on the graph. The matcher, open/close, and
keyboard belong to the shared component and are measured by [[keyboard-nav]] / [[shared-ranker]], not re-proved
here; this node proves only the lead-weight and the select-target that differ.
