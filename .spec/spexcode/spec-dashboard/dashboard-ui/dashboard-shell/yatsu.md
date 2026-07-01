---
scenarios:
  - name: shell-mounts-both-views
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard in a browser pointed at a live backend. Confirm the root shell mounts: the
      spec-graph view renders the project's node tree as tiles with the HUD/brand strip visible, and
      switching to the session view and back works. Watch the browser console for errors.
    expected: >
      The graph renders the root node and its children with the HUD present; both top-level views (graph
      and sessions) are reachable and interactive (node click / pan-zoom responds); the console shows no
      errors. Zero loss = the shell, its polled data layer, and the global styles all load and render.
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/data.js, spec-dashboard/src/styles.css]
  - name: normal-terminal-scrollback-wheel-stays-live
    tags: [frontend-e2e, desktop]
    description: >
      Through the running dashboard in a real browser, open the session interface on a live Codex-style
      normal-screen session, or a controlled shell session that has printed far more lines than fit in the
      terminal before the browser attached. Keep the terminal in the normal screen (no mouse-tracking TUI),
      then repeatedly scroll the `.xterm-viewport` with the mouse wheel from bottom toward older output and
      back down. Watch the xterm buffer position (`term.buffer.active.viewportY` if exposed from devtools, or
      the rendered first visible line) across several wheel bursts. Then drag-select text past the viewport
      edge and repeat wheel scrolling. Screenshot before/after, and record whether the wheel ever dead-ends
      until drag-selection "unsticks" it.
    expected: |
      A normal-screen session scrolls through xterm's seeded scrollback directly and continuously: each wheel
      burst changes the visible rows / viewportY until the real top or bottom is reached, and the wheel remains
      live after long output bursts, tab switches, and reconnects. Drag-select autoscroll is not a repair
      path: selecting text may scroll too, but it does not unlock anything the wheel could not already reach.
      The global dashboard CSS keeps xterm's own viewport and scroll-area geometry intact (no forced height on
      `.xterm-screen` or `.xterm-viewport`), so xterm's wheel handler, scrollTop, and buffer ydisp stay in sync.
    code: spec-dashboard/src/styles.css
    related: spec-dashboard/src/SessionTerm.jsx
---
# dashboard-shell — measurement

YATU: measure through the running dashboard in a real browser (the dev server pointed at a live `spex
serve`), not via a component unit test. The shell's loss is visible only when the whole page mounts — the
root component routes, the data layer has polled the board, and the global stylesheet has applied. File a
screenshot of the loaded graph with `spex yatsu eval dashboard-shell --scenario shell-mounts-both-views
--image <png> --pass`.
