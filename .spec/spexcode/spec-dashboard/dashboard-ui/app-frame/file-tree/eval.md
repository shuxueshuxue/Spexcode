---
scenarios:
  - name: explorer-row-menu-and-shortcuts
    description: >-
      In a running desktop dashboard, right-click a spec-node row, a disk directory row, and a governed file
      row in the Explorer; then, with a row focused, press the context-menu binding and the hold binding.
      Inspect the commands each subject is offered, where focus sits, and what the tab strip holds.
    expected: >-
      A spec node is offered open-in-a-new-tab, reveal-on-graph, copy-link and copy-node-id; a file is
      offered open-in-a-new-tab, its owning node, copy-link and copy-path; a directory is offered copy-path
      alone. The keyboard opening puts focus on the first command, arrow keys walk the rows, Escape closes it
      and returns focus to the row, and the hold binding leaves that row held as its own tab. Open-in-a-new-tab
      prints the live cap of its registered binding. No page errors.
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/FileTree.jsx
      - spec-dashboard/src/ExplorerContextMenu.jsx
      - spec-dashboard/src/DiskTree.jsx
  - name: explorer-graph-entry-opens-spec-route
    description: >-
      In a running desktop dashboard, open #/spec with the Explorer dock and activate its fixed Spec graph
      entry below the Specs and Files disclosures. Inspect the settled route and entry geometry.
    expected: >-
      The Explorer renders one fixed Spec graph entry beneath the Specs/Files sections. Activating it keeps
      the canonical #/spec route focused, without creating a second tab or a transient overlay.
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/FileTree.jsx
      - spec-dashboard/src/Shell.jsx
      - spec-dashboard/src/styles.css
  - name: the-tree-opens-the-branch-the-address-names-and-remembers-it
    tags: [frontend-e2e, desktop]
    description: >-
      Route to a NESTED spec node in a real browser and read the explorer: is that node's row present and
      painted, is it marked as the focused one, and is its ancestry disclosed? Then fold the whole dock away
      with the rail control and back, and count the rendered node rows again.
    expected: >-
      The row is present, painted, and marked; the root above it shows an open caret. Its ANCESTORS opened,
      not the node itself — disclosure means "show me what is inside", and forcing that on arrival would
      answer a question the reader never asked. After folding away and back the tree renders exactly the same
      rows: the arrangement is held outside the rows that draw it, so unmounting a branch cannot erase it.
      Zero loss = a tree that is genuinely a view of the address rather than one that merely claims to be.
    code: [spec-dashboard/src/FileTree.jsx, spec-dashboard/src/specTreeState.js]
---

Measure through the running dashboard in a real desktop browser (YATU). Capture the settled Explorer
and record the route before and after activating the graph entry, plus its bounding rectangle.
