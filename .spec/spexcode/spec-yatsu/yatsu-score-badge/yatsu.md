---
scenarios:
  - name: count-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the node-graph and look at the tiles. A node with scenarios shows a per-scenario COUNT
      pill — ✓ satisfied/total (e.g. ✓1/1, ✓0/2) — beside its version, coloured by the worst-first
      aggregate (green all fresh-pass, red any fresh fail, grey stale/blind-spot). A node with no
      yatsu.md shows NO count at all. The count never reads as the filled status dot.
    expected: >-
      Nodes with scenarios render the ✓X/Y count (a fully-satisfied node green, an outstanding one
      grey/red); the nodes without a yatsu.md render no count; the count never reads as the status
      dot. Issue badge (◆N) and scenario count sit side by side on a node that has both.
  - name: tags-render-as-chips
    tags: [frontend-e2e, desktop]
    description: >-
      Focus a node whose scenarios carry tags (e.g. public-mode) and look at the focus-panel scenario
      rows; then open the search palette and look at the SCENARIO rows. Each scenario shows its
      classification tags as a row of compact chips (the shared TagChips / `.tag-chip` element),
      identical across both surfaces; a NODE row in search shows no chips. Capture and file with
      `spex yatsu eval yatsu-score-badge --scenario tags-render-as-chips --image <png> --pass`.
    expected: >-
      Every scenario renders its tags as small paper chips wherever it surfaces (focus panel rows,
      search SCENARIO rows, eval-tab declared rows), reading off the same `.tag-chip` style; a
      scenario with mixed tags (public-mode: backend-api / frontend-e2e+desktop) shows exactly those;
      NODE rows carry no chips. The chip element and CSS are one shared definition, not per-surface.
---
# yatsu.md — yatsu-score-badge

This feature is verified by **looking** at the graph (YATU): the score badge is a visual claim, so its
loss is read with a real screenshot of the rendered board, judged against the expected, and filed as a
reading here. yatsu measuring the feature that puts yatsu's score on the graph — the loop closing on
itself.
