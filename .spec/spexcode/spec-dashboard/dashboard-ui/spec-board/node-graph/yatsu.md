---
scenarios:
  - name: drill-down-tree-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the spec-node graph. Look at the tree: depth flows left→right, the root
      layer is a short readable column, and only the focused node's ancestor spine is expanded while
      every other subtree collapses to a single tile carrying a `▸N` right-edge tab. Each node is a
      tight two-row tile — Row 1: status dot · title · version plus any overlay marks; Row 2: the live
      editors' avatars, or "last edited … ago". Press → to drill into a child and ← to drill back out;
      the tree re-plots and the camera follows focus. Screenshot the rendered tree and file it with
      `spex yatsu eval node-graph --image <png> --pass`.
    expected: >-
      The drill-down tidy-tree renders: a short root column, the focused node's spine expanded with
      sibling subtrees collapsed to `▸N` tiles, and each node a two-row tile showing its identity
      (Row 1) and its people/recency (Row 2). Arrow keys re-plot the tree and the camera stays centred
      on focus. The filed reading carries the screenshot as image evidence and a pass verdict.
---
# yatsu.md — node-graph

This view is product surface — it is measured by **looking** (YATU), not by a unit test: the agent opens
the dashboard, navigates the drill-down tree (→/← drill in/out, the camera following focus), and
screenshots the rendered two-row tiles — identity on Row 1, the live editors' avatars or recency on
Row 2 — filing it as a reading with image evidence and a verdict.
