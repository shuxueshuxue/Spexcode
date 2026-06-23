---
scenarios:
  - name: count-renders
    description: >-
      Open the node-graph and look at the tiles. A node with scenarios shows a per-scenario COUNT
      pill — ✓ satisfied/total (e.g. ✓1/1, ✓0/2) — beside its version, coloured by the worst-first
      aggregate (green all fresh-pass, red any fresh fail, grey stale/blind-spot). A node with no
      yatsu.md shows NO count at all. The count never reads as the filled status dot.
    expected: >-
      Nodes with scenarios render the ✓X/Y count (a fully-satisfied node green, an outstanding one
      grey/red); the nodes without a yatsu.md render no count; the count never reads as the status
      dot. Issue badge (◆N) and scenario count sit side by side on a node that has both.
---
# yatsu.md — yatsu-score-badge

This feature is verified by **looking** at the graph (YATU): the score badge is a visual claim, so its
loss is read with a real screenshot of the rendered board, judged against the expected, and filed as a
reading here. yatsu measuring the feature that puts yatsu's score on the graph — the loop closing on
itself.
