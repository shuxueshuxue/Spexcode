---
scenarios:
  - name: console-drag-projection-shares-row-tree
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/session-tree-disclosure.e2e.mjs
    code: spec-dashboard/src/SessionWindow.jsx
    related: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/styles.css]
    description: >-
      In Chromium, select a nested session with a title long enough to fill the selected three-line cap, then
      pointer-drag its rendered console row while the fixture keeps the current forest and selection live.
      Inspect the source and fixed drag projection's row element/state, title line boxes, marker float, nesting
      lead, and fold pod before releasing the pointer.
    expected: >-
      The live row and inert projection are one tree shape from the same current forest item: they have the
      same focused state, optional checkbox/lead/fold content, three visible title lines, and a right-floated
      status marker that only narrows line one. The projection has no focusable interaction, but no separate
      appearance snapshot or manual layout can change its content geometry.
---

Measure through the rendered desktop console in a real Chromium browser. The row-tree assertion is geometric:
compare visible `Range` line boxes and the rendered marker float while the pointer owns the drag, alongside a
drag screenshot and video; source inspection alone cannot prove the formatting context is shared.
