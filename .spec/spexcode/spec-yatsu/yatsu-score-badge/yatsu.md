---
scenarios:
  - name: badge-renders
    description: >-
      Open the node-graph and look at the cards. A node whose latest yatsu score is a fresh pass
      shows a green ringed ✓ score badge beside its version; a node with no scenario (no yatsu.md)
      shows NO score badge at all. The badge is a ringed circle, visually distinct from the filled
      status dot and the magenta issue badge.
    expected: >-
      spec-dashboard (a fresh pass reading) renders the green ringed ✓; the nodes without a
      yatsu.md — .config, config, spec-cli, spec-forge, spec-yatsu — render no score badge. The
      ringed badge never reads as the node's status dot.
---
# yatsu.md — yatsu-score-badge

This feature is verified by **looking** at the graph (YATU): the score badge is a visual claim, so its
loss is read with a real screenshot of the rendered board, judged against the expected, and filed as a
reading here. yatsu measuring the feature that puts yatsu's score on the graph — the loop closing on
itself.
