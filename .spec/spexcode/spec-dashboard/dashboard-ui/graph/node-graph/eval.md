---
scenarios:
  - name: drill-down-tree-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the spec-node graph. Look at the tree: depth flows left→right, the root
      layer is a short readable column, and only the focused node's ancestor spine is expanded while
      every other subtree collapses to a single tile carrying a `▸N` right-edge tab. Each node is a
      tight two-row tile — Row 1: status dot · title, with the pending-op glyphs (when overlays exist)
      or else the bare last-edited age at the right edge; Row 2: version, badges, and any live editors'
      avatars. Press → to drill into a child and ← to drill back out;
      the tree re-plots and the camera follows focus. Screenshot the rendered tree and file it with
      `spex yatsu eval node-graph --image <png> --pass`.
    expected: >-
      The drill-down tidy-tree renders: a short root column, the focused node's spine expanded with
      sibling subtrees collapsed to `▸N` tiles, and each node a two-row tile showing its identity and
      recency (Row 1) and its marks/people (Row 2). Arrow keys re-plot the tree and the camera stays
      centred on focus. The filed reading carries the screenshot as image evidence and a pass verdict.
  - name: tiles-carry-no-handle-dots
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the graph and inspect a tile's react-flow connection handles (the
      `.react-flow__handle` elements on its left/right edges) — read their computed style in the real
      browser, and zoom a screenshot on a tile edge. The handles exist only as edge anchors: nodes on
      this board are never interactively connectable, so no dot/circle may render on the tile edge (the
      `▸N` collapsed-count tab is unrelated and stays). The edges themselves must still draw. This must
      hold regardless of stylesheet load ORDER — the graph chunk is lazy, so xyflow's base stylesheet
      can inject after the app's, and a same-specificity override silently loses that race.
    expected: >-
      A tile's handles are fully invisible (computed style transparent/zero-opacity, no border ring) and
      non-interactive, while the parent→child edges still render anchored at the tile edges. Zero loss =
      no butt-circle on any tile edge, `▸N` tabs intact, edge count unchanged.
---
# eval.md — node-graph

This view is product surface — it is measured by **looking** (YATU), not by a unit test: the agent opens
the dashboard, navigates the drill-down tree (→/← drill in/out, the camera following focus), and
screenshots the rendered two-row tiles — identity plus the right-edge op-glyphs-or-age on Row 1, the
marks and any live editors' avatars on Row 2 — filing it as a reading with image evidence and a verdict.
