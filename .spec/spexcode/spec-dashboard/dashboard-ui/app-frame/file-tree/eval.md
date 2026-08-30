---
scenarios:
  - name: explorer-row-menu-and-shortcuts
    description: >-
      In a running desktop dashboard, right-click a spec-node row, a disk directory row, and a governed file
      row in the Explorer; then, with a row focused, press the context-menu binding and the open-in-a-new-tab binding.
      Inspect the commands each subject is offered, where focus sits, and what the tab strip holds.
    expected: >-
      A spec node is offered open-in-a-new-tab, reveal-on-graph, copy-link and copy-node-id; a file is
      offered open-in-a-new-tab, its owning node, copy-link and copy-path; a directory is offered copy-path
      alone. The keyboard opening puts focus on the first command, arrow keys walk the rows, Escape closes it
      and returns focus to the row, and the open-in-a-new-tab binding opens that row as its own tab. Open-in-a-new-tab
      prints the live cap of its registered binding. No page errors.
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/FileTree.jsx
      - spec-dashboard/src/ExplorerContextMenu.jsx
      - spec-dashboard/src/DiskTree.jsx
  - name: explorer-graph-entry-opens-spec-route
    description: >-
      In a running desktop dashboard, open #/spec with the Explorer dock and activate its fixed Spec graph
      entry below the static Specs and Files zones. Inspect the settled route and entry geometry.
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
  - name: collapse-folders-is-one-door-on-the-explorer-head
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop browser open several nested spec branches and one Files directory, read the explorer
      head, then activate its collapse-folders door. Count open branches in both projections, verify the static
      Specs and Files zone heads carry no aria-expanded, read the route and door's disabled state, and reopen one node.
    expected: >-
      The door sits on the dock head beside search — never inside a zone head — with a tooltip and an accessible
      name. One activation folds every open spec branch AND every open disk directory while both static zones and
      their roots stay listed and the route is untouched; the door is disabled once nothing is open; reopening one
      node reveals only that branch.
    code:
      - spec-dashboard/src/FileTree.jsx
      - spec-dashboard/src/specTreeState.js
      - spec-dashboard/src/DiskTree.jsx
      - spec-dashboard/src/Dock.jsx
      - spec-dashboard/test/explorer-collapse-folders.e2e.mjs
  - name: disclosure-is-a-chevron-and-nesting-is-a-line
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop browser open a nested branch in the Specs zone and a directory in the Files zone. Read
      the disclosure mark of an open row and a closed row (element kind, rotation), verify the zone heads have
      no disclosure marks, and whether any row still prints a triangle character; then read, for a row three
      levels deep, how many hairline guides run through its left margin and where they sit against the
      ancestors' caret slots. LOOK at the screenshot.
    expected: >-
      Every collapsible row carries one stroke chevron (an svg, no ▸/▾ text), rotated 90° when open and 0°
      when closed; the static zone heads carry no chevron; a row at depth N shows exactly N one-pixel guides, each aligned
      to the caret centre of the ancestor at that level, joining into continuous lines down the branch.
    code:
      - spec-dashboard/src/FileTree.jsx
      - spec-dashboard/src/DiskTree.jsx
      - spec-dashboard/src/icons.jsx
      - spec-dashboard/test/explorer-collapse-folders.e2e.mjs
---

Measure through the running dashboard in a real desktop browser (YATU). Capture the settled Explorer
and record the route before and after activating the graph entry, plus its bounding rectangle.
