---
scenarios:
  - name: a-folder-stays-open-across-the-files-fold
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop browser open the Explorer's Files section, open one directory inside it, then close
      the Files section and reopen it. Read the directory row's aria-expanded after the reopen. Then activate
      the explorer head's collapse-folders door and count open directory rows.
    expected: >-
      The directory is still open after the section fold — its disclosure is held in the explorer's shared
      store, not on the row the fold unmounted — and the one collapse door folds it together with the spec
      branches, leaving the Files section itself open with its roots listed.
    code:
      - spec-dashboard/src/DiskTree.jsx
      - spec-dashboard/src/specTreeState.js
      - spec-dashboard/test/explorer-collapse-folders.e2e.mjs
---

Measure through the running dashboard in a real desktop browser (YATU); the section fold is the
disclosure control on the Files head, the collapse door is on the dock head.
