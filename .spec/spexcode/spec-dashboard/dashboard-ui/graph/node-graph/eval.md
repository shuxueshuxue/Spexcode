---
scenarios:
  - name: drill-down-tree-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard on the spec-node graph. Look at the tree: depth flows left→right, the root
      layer is a short readable column, and the focused node's immediate children are visible while sibling
      subtrees collapse to a single tile carrying a `▸N` right-edge tab. Each node is a
      tight two-row tile — Row 1: status dot · title, with the pending-op glyphs (when overlays exist)
      or else the bare last-edited age at the right edge; Row 2: version, badges, and any live editors'
      avatars. Press → to drill into a child and ← to drill back out;
      the tree re-plots and the camera follows the reading-pair anchor (43%, or the parent-focus midpoint
      for a leaf), with fit-left treatment when the visible bbox already fits. Measure the anchor against the
      graph rectangle after the pan settles. Record the navigation as
      video and screenshot the settled framing; file both with the pass verdict.
    expected: >-
      The drill-down tidy-tree renders: a short root column, one focused layer with sibling subtrees
      collapsed to `▸N` tiles, and each node a two-row tile showing its identity and
      recency (Row 1) and its marks/people (Row 2). Arrow keys re-plot the tree and the camera keeps the reading
      pair at 43% (or the leaf midpoint), with vertical reachability and fit-left treatment where applicable.
      The filed reading carries video of the focus-follow movement, a screenshot of its settled framing,
      and a pass verdict.
  - name: close-active-tab-returns-to-graph
    tags: [frontend-e2e, desktop]
    description: >-
      Open two spec documents as tabs, focus one, then close the active tab. Leave the other tab on the
      strip and inspect the routed surface and active-tab styling after the close.
    expected: >-
      Closing the active document returns to `#/graph` (the document-free bottom sheet) without focusing
      the neighbour; the other spec tab remains in its original strip order and is visibly inactive.
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
      graph transforms, solid edge paths, the viewport transform, and the computed transition properties
      on React Flow's node containers.
    expected: >-
      The first rendered topology after the drill is already final: newly revealed children and their
      solid edges appear together, persisting nodes occupy their final graph slots, and no later frame visibly
      changes a node's graph transform or solid edge path. Meanwhile the viewport crosses progressive screen
      positions before settling with focus centred, preserving the move's direction; node containers may
      transition opacity but never transform. The filed reading carries video because a settled still cannot
      distinguish a connected camera move from detached structural animation.
  - name: plugins-node-uses-ordinary-tree
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/plugin-node.e2e.mjs
    description: >-
      Open a graph whose `.plugins` branch contains nested specs. On the initial frame, inspect the `.plugins`
      tile against its graph payload. It must display the raw `.plugins` title and version, plus the ordinary
      direct-child `▸N` tab when collapsed. Focus the tile and confirm only its immediate children appear.
    expected: >-
      `.plugins` is an ordinary graph node: no renamed group label, dashed group style, subtree count, or
      path-derived data attribute appears. Its raw identity and direct-child count agree with the payload,
      and normal focus reveals its immediate children. The filed evidence includes initial and expanded
      browser screenshots.
  - name: deep-frontier-boxes-do-not-overlap
    tags: [frontend-e2e, desktop]
    description: >-
      Against the real project board (not a fixture), focus the deepest available node in the 362-node
      graph and wait for the single-layer frontier to settle. Through CDP, read every visible
      `.react-flow__node` bounding box and assert that every pair has a separating edge; record the node
      count, the minimum same-column centre gap, and the pair count. Capture one zoomed-out panorama and
      one settled focus crop from the same run.
    expected: >-
      The deepest real-data frontier renders without any pairwise box intersection. The reading reports
      the sampled visible-node count and zero intersecting pairs, and carries both the panorama and local
      screenshots from the settled browser.
---
# eval.md — node-graph

Current camera measurements supersede older centre-framing readings: on every keyboard/click/programmatic
focus move assert a root's focus→child midpoint at the `43%` horizontal token, or a non-root focus tile
centre at the `50%` horizontal token, with the focus tile centre at the vertical canvas centre and the
pre-move zoom unchanged. Only the first frame or an explicit pane resize may use fit-left with one grid-column
gutter; fit may lower zoom but never raise a deliberate user zoom.

This view is product surface — it is measured by **looking** (YATU), not by a unit test: the agent opens
the dashboard, records navigation through the drill-down tree (→/← drill in/out, the camera following
focus), and screenshots the settled two-row tiles — identity plus the right-edge op-glyphs-or-age on Row 1,
the marks and any live editors' avatars on Row 2 — with the focus→child reading pair at the graph pane's
43% horizontal token (or the parent↔focus midpoint for a leaf), the focus tile centre vertically, and zoom
unchanged across the focus move. The recording and screenshot ride together with the verdict. Structural readings
sample browser frames around the interaction
and distinguish graph-space geometry from the moving viewport: a still cannot prove that the tree stayed
connected while the camera supplied direction.
