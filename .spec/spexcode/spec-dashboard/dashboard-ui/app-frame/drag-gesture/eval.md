---
scenarios:
  - name: below-threshold-press-stays-click
    description: >-
      In a real Chromium dashboard served by this worktree's Vite dev server, click an inactive movable tab
      face without moving the pointer beyond the gesture threshold and inspect the route and active tab.
    expected: >-
      The press remains an ordinary click: the inactive tab activates, its URL becomes current, and no drag
      callbacks or click swallowing interfere with navigation.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/dragGesture.js, spec-dashboard/src/TabStrip.jsx]
    test: spec-dashboard/test/tab-click-activates.e2e.mjs

---

Measure YATU through the real dashboard in Chromium; the tab click scenario records the settled route and
visible strip as the product evidence for the shared gesture contract.
