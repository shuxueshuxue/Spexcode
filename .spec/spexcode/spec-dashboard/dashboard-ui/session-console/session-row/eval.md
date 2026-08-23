---
scenarios:
  - name: dock-row-drag-keeps-one-live-tree
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-row-dock.e2e.mjs
    code: [spec-dashboard/src/SessionWindow.jsx, spec-dashboard/src/Dock.jsx]
    related: spec-dashboard/src/styles.css
    description: >-
      In Chromium, open the current sessions dock with a present parent/child pair and a separate root target.
      Drag the child row toward the target while the dashboard keeps the live forest rendered.
    expected: >-
      The dock keeps one live row tree: the source row receives its dragging state, a valid target receives
      drop-target state, and no checkbox or inert ghost is rendered. Releasing sends the ordinary reparent
      request; no second selection model or duplicate row appearance is created.
---

Measure through the rendered desktop dock in a real Chromium browser. The YATU assertion reads the source and
target row classes while the pointer owns the drag and confirms the reparent request boundary.
