---
scenarios:
  - name: sessions-row-selection-and-tree-drag
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-multi-select.e2e.mjs
    code:
      - spec-dashboard/src/SessionForestPanel.jsx
      - spec-dashboard/src/SessionSelectBar.jsx
      - spec-dashboard/src/SessionContextMenu.jsx
      - spec-dashboard/src/SessionWindow.jsx
    related:
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/Dock.jsx
      - spec-dashboard/src/Shell.jsx
      - spec-dashboard/src/styles.css
    description: >-
      In Chromium, open the routed Sessions document with a parent/child pair and an unrelated root. Enter
      row selection from the child context menu, add a second row, cancel, then drag the child to a valid
      parent and to the top-level drop zone while observing the rendered ghost and target feedback.
    expected: >-
      Sessions owns explicit row multi-select independently of graph marquee selection. The selection bar
      stays on one line at the narrow forest width: the count truncates rather than wrapping, the danger trash
      icon and × icon remain fully inside the bar, and each is keyboard reachable by its localized accessible
      name. The bar reports both checked rows and cancel exits selection. A full-row drag renders a 75% inert row ghost,
      highlights valid hierarchy targets, sends the reparent request on release, and sends parent: null at
      the top-level zone; self/descendant/current-parent releases are no-ops.
---

## focused browser scenarios

- Enter selection from a row context menu; the row is checked and the bar reports one selected.
- Toggle a second row without changing the active session; cancel clears the mode.
- Confirm bulk close and observe one close request per selected row followed by board reconciliation.
- Drag a nested row far enough to show the real row ghost, move over a valid parent, and observe target feedback.
- Drag the same row to the top-level drop zone and observe a `parent: null` reparent request.
- Release on self, a descendant, or the current parent and observe no request.
