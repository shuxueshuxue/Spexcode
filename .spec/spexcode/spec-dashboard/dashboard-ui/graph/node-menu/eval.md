---
scenarios:
  - name: right-click-opens-node-menu
    description: >
      On the board, right-click a spec node tile. Then pick "node info" from the menu that appears.
      Also right-click the empty pane with the menu open, and check Esc/outside-click dismissal.
    expected: >
      Right-clicking a node suppresses the browser's default context menu and opens the custom node
      menu at the cursor with exactly five items — node info, copy node URL, new session, new child node…, delete
      node… (the last one danger-tinted) — and the clicked node becomes the focused node. Picking
      "node info" closes the menu and opens the node's info popup; "new session" / "new child node…" /
      "delete node…" land on a New Session pre-seeded with the node mention / chord instruction.
      Esc or a click outside closes the menu without disturbing the board; a right-click anywhere off
      the menu dismisses it too (the default browser menu stays available off-node).
    tags: [frontend-e2e]
  - name: menu-lists-overlay-sessions
    description: >
      Right-click a spec node that currently carries a session overlay (a live worktree's pending ops
      touch it). Below the five fixed actions, the menu appends one item per overlaying session — a
      status-coloured glyph plus the session's name. Clicking a session item closes the menu and opens
      that session in the console (route → `#/sessions/<id>`). Right-click a node with NO overlay and
      confirm the menu shows only the five fixed actions (no session section, no empty divider).
    expected: >
      When (and only when) a node has session overlay(s), the right-click menu lists those sessions as
      its last items, one per session, below a divider from the verbs; clicking one opens that session
      in the console. This is the menu's single crossing into an existing session — the graph has no
      bare keystroke for it ([[keyboard-nav]]). A node with no overlay shows just the five fixed actions.
    tags: [frontend-e2e]
  - name: copy-node-url
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard at a focused non-root node, right-click its tile, choose Copy node URL, and read the
      real browser clipboard after the copied confirmation appears. Repeat at a project-scoped pathname when
      available. Screenshot the confirmation state and file with
      `spex yatsu eval node-menu --scenario copy-node-url --image <png> --pass`.
    expected: >-
      The menu's copy row has the shared copy icon and a localized label. It copies the canonical full
      `#/graph/<node-id>` URL, preserving the document's origin and any `/p/<project>/` scope; it never
      emits a bare hash, a hardcoded tunnel host, or an unfocused graph route. The brief copied/failed result
      is honest and then the menu dismisses.
---
Measure YATU through a real browser (headless Chromium) against the worktree dashboard: dispatch a
`contextmenu` event on a `.spec-node` tile (Playwright's `click({ button: 'right' })`), read the real
DOM for the menu and its items, screenshot it, then click an item and verify the popup / New Session
surface it routes to.
