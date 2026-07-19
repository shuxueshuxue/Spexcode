---
scenarios:
  - name: count-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the node-graph and look at the tiles. A node with scenarios shows a per-scenario COUNT
      pill — ✓ satisfied/total (e.g. ✓1/1, ✓0/2) — beside its version, coloured by the worst-first
      aggregate (green all fresh-pass, red any fresh fail, grey stale/blind-spot). A node with no
      eval.md shows NO count at all. The count never reads as the filled status dot.
    expected: >-
      Nodes with scenarios render the ✓X/Y count (a fully-satisfied node green, an outstanding one
      grey/red); the nodes without an eval.md render no count; the count never reads as the status
      dot. Issue badge (◆N) and scenario count sit side by side on a node that has both.
  - name: score-affordances-navigate
    tags: [frontend-e2e, desktop]
    description: >-
      In a real browser, focus a node with scenarios and open its Information Board (node-info popup,
      key `i`). Every eval affordance must be a REAL `<a href>`: the stat-bar aggregate ✓X/Y count
      links to the node-filtered Evals LIST; each eval-tab reading row carries a sibling anchor to the
      canonical full-page detail `#/evals/<node>/<scenario>` (no session sub-route, no list filters on
      the detail hash). Click a reading's anchor → the detail renders; browser Back → the exact
      `#/graph` hash with the SAME node still focused. Click the aggregate count → the Evals list
      filtered to the node. Tab + Enter on a row anchor follows its href. No interactive link nests
      inside another control (the eval-tab expand toggle stays a sibling button; the graph TILE count
      stays passive — the tile's click belongs to the board). Record the whole loop and file with
      `spex eval add eval-score-badge --scenario score-affordances-navigate --video <webm>`.
    expected: >-
      Concrete reading affordances are real anchors PUSHING to `#/evals/<node>/<scenario>`; the
      stat-bar aggregate count is a real anchor to the node-filtered Evals list, minted by the ONE
      shared address helper; browser Back restores the original graph hash and focus; middle-click/
      copy-link work because the href is real; nothing navigates via a click handler on a bare button,
      and no anchor nests inside the expand toggle.
  - name: tags-render-as-chips
    tags: [frontend-e2e, desktop]
    description: >-
      Open the search palette and look at SCENARIO rows for a node whose scenarios carry tags (e.g.
      public-mode); then open that node's eval tab and inspect its declared-scenario rows. Each shows its
      classification tags as a row of compact chips (the shared TagChips / `.tag-chip` element),
      identical across both surfaces; a NODE row in search shows no chips. Capture and file with
      `spex eval add eval-score-badge --scenario tags-render-as-chips --image <png> --pass`.
    expected: >-
      Every scenario renders its tags as small paper chips wherever it surfaces (search SCENARIO rows and
      eval-tab declared rows), reading off the same `.tag-chip` style; a
      scenario with mixed tags (public-mode: backend-api / frontend-e2e+desktop) shows exactly those;
      NODE rows carry no chips. The chip element and CSS are one shared definition, not per-surface.
---
# eval.md — eval-score-badge

This feature is verified by **looking** at the graph (YATU): the score badge is a visual claim, so its
loss is read with a real screenshot of the rendered board, judged against the expected, and filed as a
reading here. eval measuring the feature that puts eval's score on the graph — the loop closing on
itself.
