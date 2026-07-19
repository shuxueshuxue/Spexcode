---
scenarios:
  - name: full-width-without-sidebar
    tags: [frontend-e2e, desktop]
    description: >-
      Open the graph page in a real desktop browser after the board settles. Measure the main content,
      graph page, canvas, and focused tile rectangles; inspect the DOM for a persistent focus panel or
      graph-side resize divider; and capture the whole board after focus framing settles.
    expected: >-
      The graph page and canvas consume the main area's full width and height, with no persistent focused-node
      sidebar, no graph resize divider, and no document horizontal overflow. The focused tile's centre matches
      the graph pane's centre on both axes after camera framing settles. Issues and eval details remain available
      on demand through their routed pages and the node-info popup.
    code:
      - spec-dashboard/src/Dashboard.jsx
      - spec-dashboard/src/styles.css
---
# graph measurement

Measured by looking through the running desktop product. The screenshot proves the released viewport, while
DOM rectangles and absence checks distinguish a genuinely removed sidebar from one merely hidden off-screen.
