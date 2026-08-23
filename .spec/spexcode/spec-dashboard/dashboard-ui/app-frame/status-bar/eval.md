---
scenarios:
  - name: flow-row-does-not-cover-terminal
    tags: [frontend-e2e, desktop]
    description: >-
      At 1440px, open a live session's terminal face and wait for xterm to fit and render. Measure the app
      content row, sidebar, xterm screen and final xterm row against the status bar, then take settled full,
      lower-left-junction, and lower-right-junction screenshots.
    expected: >-
      Rail and optional dock continue to the viewport bottom. The status bar is the final unshrinking child
      of the right content column, starts exactly at the sidebar's right edge, and has the content row ending
      at its top edge. The xterm screen and its complete last rendered row end at or above that same edge;
      neither output nor caret is covered. The vertical sidebar/content and horizontal content/status seams
      are single 1px `--line` strokes with clean lower-left and lower-right junctions.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/StatusBar.jsx, spec-dashboard/src/styles.css]
  - name: project-identity-is-one-status-door
    tags: [frontend-e2e, desktop]
    description: >-
      Open a scoped dashboard through a real hub catalog. Inspect the rail and status DOM, open the compact
      project identity button, exercise an online project row and the global Projects row, and repeat with
      an offline catalog project and a project-only guest.
    expected: >-
      Exactly one project identity trigger exists and it is in the status row, showing a 14px project mark
      plus the visible project name; the rail has no project chip. The menu retains online same-tab links,
      visibly inert offline rows, current-project identity/check state, and a global `/projects` entry. A
      denied guest sees the same identity control as the login door but no catalog rows.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/SideBar.jsx, spec-dashboard/src/styles.css]
    test: spec-dashboard/test/identity-chain.e2e.mjs
---
# measuring the status bar

YATU: use a real Chromium page. Geometry claims come from settled DOM rectangles and a screenshot; project
switching claims come from the actual scoped gateway, catalog, and native links rather than a mocked menu.
