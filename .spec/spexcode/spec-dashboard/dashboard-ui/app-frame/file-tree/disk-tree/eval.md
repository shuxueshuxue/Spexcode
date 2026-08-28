---
scenarios:
  - name: a-folder-stays-open-across-the-files-fold
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop browser read the always-mounted Explorer Files zone, open one directory inside it,
      and read the directory row's aria-expanded. Then activate the explorer head's collapse-folders door and
      count open directory rows.
    expected: >-
      The directory remains open in the static Files projection — its disclosure is held in the explorer's
      shared store, not on a section fold — and the one collapse door folds it together with the spec branches,
      leaving the Files zone and its roots listed.
    code:
      - spec-dashboard/src/DiskTree.jsx
      - spec-dashboard/src/specTreeState.js
      - spec-dashboard/test/explorer-collapse-folders.e2e.mjs
---

Measure through the running dashboard in a real desktop browser (YATU); the Files zone is static and only
directory rows disclose, while the collapse door remains on the dock head.
