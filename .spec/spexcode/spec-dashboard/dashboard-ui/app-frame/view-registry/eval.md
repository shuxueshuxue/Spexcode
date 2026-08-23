---
scenarios:
  - name: address-selects-one-surface
    description: >
      In a real browser, open a graph address and an eval detail address both by direct URL and by in-app
      navigation. Inspect the settled chrome and then return with browser Back.
    expected: >
      Both cold and hot eval detail routes render the same review surface: rail and full-width status bar,
      with no Explorer, dock, or tab strip. Graph renders the workspace surface with Explorer, dock, and tab
      strip, and Back restores that workspace surface without changing the persisted workspace tab set.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/views.jsx, spec-dashboard/src/viewRegistry.js, spec-dashboard/src/viewRegistry.test.mjs, spec-dashboard/src/Root.jsx, spec-dashboard/src/App.jsx]
---

Measure through the built dashboard in this worktree and a real browser against the running Spex backend.
Use the `surface-shell-cold-review`, `surface-shell-hot-review`, `surface-shell-workspace-graph`, and
`surface-shell-back-workspace` screenshots as the settled surface evidence.
