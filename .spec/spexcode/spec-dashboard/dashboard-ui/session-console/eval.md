---
scenarios:
  - name: native-terminal-default-input
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/terminal-input.e2e.mjs
    description: >-
      Open a live session in a real browser and immediately type prose, arrows, Escape, and committed Chinese
      IME text into the agent TUI. Inspect focus, terminal WebSocket messages, and the rendered TUI response.
    expected: >-
      The xterm is focused and interactive without entering a mode. Its native ordered data reaches the same
      visible tmux client exactly once, including committed IME text. There is no docked second input, type-mode
      indicator, raw-key HTTP batch, screen sniff, or general DOM-key vocabulary; the sole Shift+Enter bridge
      emits the modified `ESC CR` sequence rather than collapsing into ordinary Enter.
  - name: command-box-opens-and-grows-upward
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      In a live terminal press Cmd+I or Alt+I, measure the Command Box and terminal before and after entering
      several lines, then close and reopen it. Repeat in a narrow desktop pane and press Alt+Cmd+I.
    expected: >-
      The named Command Box opens focused and horizontally centered in the lower middle, with its bottom edge
      near 68% of the terminal pane. Its width shrinks safely; its footer stays fixed while content grows upward
      to a cap; xterm geometry never changes. Close/reopen preserves the session draft and returns focus to the
      TUI. Alt+Cmd+I is not consumed by the app.
  - name: command-box-send-failure-and-success
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Author a multi-line prompt in Command Box, force one dispatch failure, then restore the live control
      channel and send successfully while observing the draft, surface, request count, and TUI.
    expected: >-
      The failure leaves Command Box open with the complete draft and visible error. Success sends one atomic
      control prompt, clears the draft, closes the box, and focuses xterm. Neither attempt types the prompt
      character-by-character through the PTY.
  - name: command-box-commands-mentions-and-files
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Open Command Box and exercise `/`, `[[`, and `@` completion plus paste/drop/pick attachment. Accept a
      board command row and authoring rows, then send a known node reference against the live spec index.
    expected: >-
      Board commands lead the slash list tagged ui and execute locally from the toolbar registry; `/type` is
      absent. Presets and harness commands insert text. Node/session menus are the shared mention menus and a
      known `[[node]]` expands at send to its live spec.md pointer. An attached file becomes one worker-local
      path in the draft. Menus fit above the lower-middle box without covering its footer.
  - name: board-command-parity
    tags: [frontend-e2e, desktop]
    description: >-
      Across working, review, done, offline, and queued sessions compare toolbar tools with Command Box board
      rows. Trigger Command Box, merge, relaunch, stop, close, and eval through each available surface.
    expected: >-
      One registry decides availability, icon, color, accessible label, and action. Command Box is the stable
      resident right-edge tool while live; merge/relaunch sit to its left as applicable. Stop and close remain
      Command Box-only typed verbs; Eval is a permanent anchor plus `/eval`. Offline and queued sessions cannot
      open Command Box, and no `/type` or type tool exists.
  - name: modifier-arrows-switch-sessions
    tags: [frontend-e2e, desktop]
    description: >-
      With focus in New Session, Command Box, the live xterm, and inert console chrome, press plain and
      Cmd/Alt/Ctrl-modified Up/Down and observe both session selection and the focused surface.
    expected: >-
      Plain arrows stay with textareas and xterm but navigate the list from inert chrome. Each documented
      modifier-arrow chord switches one visible session from every focus location without leaking into the
      TUI. App-global Alt chords still route through the shell.
  - name: session-sidebar-density-and-selected-cap
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >-
      Clear the saved pane width, open a console with short and very long generated session headlines, select
      the longest row, then resize the sidebar and inspect typography, row geometry, tooltip, and terminal width.
    expected: >-
      The default sidebar is 204px, remains user-resizable, and uses caption-size row text. Resting rows stay one
      line. Only the selected headline expands, to no more than three lines; its complete text remains in the
      tooltip/accessibility name and status metadata stays at the first-line top-right. No row overlap occurs.
  - name: triage-zones-and-status-colour
    tags: [frontend-e2e, desktop]
    description: >-
      Render sessions spanning actionable, working, starting, queued, and offline liveness, including a dead
      session whose authored lifecycle remains review. Inspect grouping, ordering, glyphs, tooltips, and colors.
    expected: >-
      Needs-you, running, and offline zones are in that order, newest-first within each. Offline liveness wins
      over stale lifecycle for grouping. Compact rows use the shared status glyph and STATUS_COLOR vocabulary,
      with the full status in the tooltip and no duplicate toolbar identity/status line.
  - name: terminal-selection-survives-mouse-mode
    tags: [frontend-e2e, desktop]
    description: >-
      In a real mouse-reporting TUI, force a local selection with the universal modifier convention
      (Shift-drag; Option-drag on macOS) while the application owns the mouse, copy it with Cmd/Ctrl+C,
      then drag without the modifier and wheel through both normal history and the full-screen application.
    expected: >-
      Modifier-drag produces one uninterrupted local selection and copy works on secure and plain HTTP
      contexts; selection does not move the glyph grid. An unmodified drag and the wheel travel to the
      application as native SGR mouse reports — no browser scrollbar, no bridge wheel vocabulary — while
      keyboard input remains live through xterm.
  - name: terminal-toolbar-and-eval-door
    tags: [frontend-e2e, desktop]
    description: >-
      Switch live sessions and route through the permanent Eval door at wide and narrow desktop widths across
      themes, locales, long headlines, Command Box visibility, and eval loading/error/zero states.
    expected: >-
      Terminal is the sole tab; Eval is a real canonical anchor outside the tablist and no inline eval pane
      mounts. The compact toolbar stays one line, visually separate from the terminal, with honest eval summary
      states and all available icon tools visible. The warm terminal survives navigation and browser Back.
  - name: create-stays-on-new-and-close-falls-back
    tags: [frontend-e2e, desktop]
    description: >-
      Launch several sessions quickly from New Session, then close the active and a background session while
      observing prompt focus, URL selection, and list updates.
    expected: >-
      Launch clears immediately, stays focused on New, and never waits or auto-switches. Removing the active
      session falls back to New; removing a background session preserves the current valid selection.
  - name: launcher-picker-is-config-shaped
    tags: [frontend-e2e, desktop]
    description: >-
      Open the New Session launcher picker with multiple configured Claude/Codex profiles, select one, reload,
      then remove that profile from settings and revisit the picker.
    expected: >-
      A centered pop-out lists each profile once with its harness icon, name, full inert command, and selected
      state. Selection closes and persists while valid, otherwise the configured default wins. No inline command
      editor or launcher-specific session shape appears.
  - name: row-context-and-external-reveal
    tags: [frontend-e2e, desktop]
    description: >-
      Right-click a nested session row, exercise lock/rename/select/attach/close availability, then open a session
      hidden below collapsed ancestors from the graph node menu and an originator chip.
    expected: >-
      The shared context menu exposes state-appropriate actions without stealing terminal focus. External opens
      unfold every present ancestor, reveal and select the row, and keep URL/session identity synchronized.
  - name: session-window-remains-bounded
    tags: [frontend-e2e, desktop]
    description: >-
      Populate enough sessions to exceed 80% viewport height and inspect the map-side SessionWindow against the
      graph stats strip while scrolling and selecting rows.
    expected: >-
      The window stays bounded above the stats strip and scrolls internally. It retains avatars, shared compact
      headlines, status glyphs, triage grouping, and graph-lock gestures without becoming the console sidebar.
---

Measure these scenarios through the running dashboard and real sessions. Dynamic focus, terminal input,
Command Box growth, and routing require recorded browser interaction; static sidebar geometry uses screenshots.
