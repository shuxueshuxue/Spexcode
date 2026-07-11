---
scenarios:
  - name: cmd-slash-opens-sessions-first
    tags: [frontend-e2e, desktop]
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
  - name: search-pill-opens-same-palette
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session console (Enter) and read the session
      list's top button row: beside the ＋ New Session pill there must be a Search pill whose glyph is a
      monochrome inline-SVG magnifier (currentColor stroke, never an emoji) and whose tooltip (title
      attribute) teaches the ⌘+/ chord. Click it and compare what opens against pressing ⌘/Ctrl+/: it must
      be the SAME palette component (`.search-panel` over its backdrop), sessions leading the ranked rows.
      Esc closes it back to the console with the selected tab unchanged and the pill wearing no pressed/on
      state. Screenshot the top row and the open palette.
    expected: |
      A Search pill sits beside ＋ in the top row — inline-SVG magnifier, no emoji, title naming ⌘+/.
      Clicking it opens the one shared search palette exactly as the chord does (same `.search-panel`,
      session plane boosted to lead), never a second search implementation; the selected session tab does
      not change, and after Esc the console is back with no persistent .on state on the pill. Button and
      chord are two triggers of a single open path.
    related:
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/App.jsx
  - name: pick-routes-session-vs-node
    tags: [frontend-e2e, desktop]
    description: >
      With the ⌘/Ctrl+/ palette open over the session board, first pick a SESSION result (click or Enter on a
      highlighted session row) and watch where you land. Reopen the palette and this time pick a SPEC NODE
      result. Watch whether the session view stays or closes and where focus lands. Screenshot
      after each pick.
    expected: |
      Picking a SESSION opens/switches to that session's tab in the console — you stay on the session board,
      now on the chosen session. Picking a SPEC NODE closes the session view and jumps to that node on the
      graph, focused and revealed. Issue/scenario result routing belongs to [[address-routing]]; this
      session-board scenario proves only the session boost and the session-vs-node select target that differ
      from the graph palette.
    related:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SessionInterface.jsx
---

# session-search — yatsu

Measure through the **real running dashboard in a browser**, YATU-style: open the session console with
`Enter`, fire the actual ⌘/Ctrl+/ chord, and drive the real palette — never a direct call into `SpecSearch`'s
`rank`/`onPick` and never an internal helper chosen to make the proof easy. The loss is the two contracts
this node owns on top of the shared [[shared-ranker]] palette: **sessions lead** the ranking when opened from
the session board (while every other plane stays visible below), and the **session-vs-node** select target
differs from the graph palette. Issue/scenario review-object selection is the cross-cutting
[[address-routing]] contract. The matcher, open/close, and keyboard belong to the shared component and are
measured by [[keyboard-nav]] / [[shared-ranker]], not re-proved here.
