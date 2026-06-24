---
scenarios:
  - name: shell-mounts-both-views
    description: >
      Open the dashboard in a browser pointed at a live backend. Confirm the root shell mounts: the
      spec-graph view renders the project's node tree as tiles with the HUD/brand strip visible, and
      switching to the session view and back works. Watch the browser console for errors.
    expected: >
      The graph renders the root node and its children with the HUD present; both top-level views (graph
      and sessions) are reachable and interactive (node click / pan-zoom responds); the console shows no
      errors. Zero loss = the shell, its polled data layer, and the global styles all load and render.
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/data.js, spec-dashboard/src/styles.css]
---
# dashboard-shell — measurement

YATU: measure through the running dashboard in a real browser (the dev server pointed at a live `spex
serve`), not via a component unit test. The shell's loss is visible only when the whole page mounts — the
root component routes, the data layer has polled the board, and the global stylesheet has applied. File a
screenshot of the loaded graph with `spex yatsu eval dashboard-shell --scenario shell-mounts-both-views
--image <png> --pass`.
