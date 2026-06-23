---
scenarios:
  - name: open-count-badge-on-tile
    description: >-
      Open the dashboard and look at a node the forge linked an open issue to (e.g. spec-cli). Its
      tile carries a magenta ◆N open-issue count badge, distinct from the status dot and the drift
      badge. There is NO issue card popped on the node's hover/focus — the issue LIST is read in the
      left focus panel instead. Screenshot the board and file with
      `spex yatsu eval dashboard-issues --image <png> --pass`.
    expected: >-
      A node with open issues shows the ◆N count badge on its tile (and none at zero); no `.issue-popover`
      card is rendered on the node; the open-issue list is read in the left focus panel. The badge is
      bound work, never the node's git-derived status.
    code:
      - spec-dashboard/src/SpecNode.jsx
---
# yatsu.md — dashboard-issues

Product surface, measured by **looking** (YATU): the agent screenshots the rendered board showing the
◆N open-issue glance badge on a tile, and confirms the bound-work DETAIL now lives in the left focus panel
(no on-node popover), filing it as a reading with image evidence and a verdict. The scenario scopes its
freshness to `SpecNode.jsx` (where this node's badge slice lives), not the backend fold files.
