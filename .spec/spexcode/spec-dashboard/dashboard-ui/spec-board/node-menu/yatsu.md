---
scenarios:
  - name: right-click-opens-node-menu
    description: >
      On the board, right-click a spec node tile. Then pick "node info" from the menu that appears.
      Also right-click the empty pane with the menu open, and check Esc/outside-click dismissal.
    expected: >
      Right-clicking a node suppresses the browser's default context menu and opens the custom node
      menu at the cursor with exactly four items — node info, new session, new child node…, delete
      node… (the last one danger-tinted) — and the clicked node becomes the focused node. Picking
      "node info" closes the menu and opens the node's info popup; "new session" / "new child node…" /
      "delete node…" land on a New Session pre-seeded with the node mention / chord instruction.
      Esc or a click outside closes the menu without disturbing the board; a right-click anywhere off
      the menu dismisses it too (the default browser menu stays available off-node).
    tags: [frontend-e2e]
---
Measure YATU through a real browser (headless Chromium) against the worktree dashboard: dispatch a
`contextmenu` event on a `.spec-node` tile (Playwright's `click({ button: 'right' })`), read the real
DOM for the menu and its items, screenshot it, then click an item and verify the popup / New Session
surface it routes to.
