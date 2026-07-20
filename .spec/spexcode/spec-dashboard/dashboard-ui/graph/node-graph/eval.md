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
      the tree re-plots and the camera follows focus, framing the focused tile at the graph pane's
      geometric centre. Measure the focused tile centre against the graph rectangle after the pan settles. Record the navigation as
      video and screenshot the settled framing; file both with the pass verdict.
    expected: >-
      The drill-down tidy-tree renders: a short root column, the focused node's spine expanded with
      sibling subtrees collapsed to `▸N` tiles, and each node a two-row tile showing its identity and
      recency (Row 1) and its marks/people (Row 2). Arrow keys re-plot the tree and the camera keeps the focused
      tile centred on both axes of the graph pane. The filed reading carries video of the focus-follow movement, a screenshot of its settled framing,
      and a pass verdict.
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
  - name: structural-updates-are-atomic
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the graph and drill right into a collapsed branch so children are newly
      revealed and the existing neighbourhood re-plots. Record the interaction at browser-frame cadence
      and compare the last frame before the topology update with every frame after it. Inspect node
      transforms, solid edge paths, the viewport transform, and the computed transition on React Flow's
      node containers.
    expected: >-
      The first rendered topology after the drill is already final: newly revealed children and their
      solid edges appear together, persisting nodes occupy their final slots, and no later frame changes a
      node's graph position, an edge path, or the viewport after its one snap to the new focus. Node containers
      declare no transition. The filed reading carries video of the interaction because a settled still cannot
      prove the absence of intermediate motion.
---
# eval.md — node-graph

This view is product surface — it is measured by **looking** (YATU), not by a unit test: the agent opens
the dashboard, records navigation through the drill-down tree (→/← drill in/out, the camera following
focus), and screenshots the settled two-row tiles — identity plus the right-edge op-glyphs-or-age on Row 1,
the marks and any live editors' avatars on Row 2 — with focus at the graph pane's geometric centre. The
recording and screenshot ride together with the verdict. Atomic-update readings sample browser frames around
the interaction: a still of the settled graph cannot prove that no intermediate motion occurred.
