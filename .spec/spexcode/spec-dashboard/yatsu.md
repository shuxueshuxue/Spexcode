---
scenarios:
  - name: board-renders
    driver: manual
    target: http://localhost:5173
    steps:
      - open the dashboard at http://localhost:5173 and let the spec-graph settle
      - the spexcode root and its package children render as node cards, each with its version and freshness
      - capture the board and record it — `spex yatsu eval spec-dashboard --image <png>`
---
# yatsu.md — spec-dashboard

The dashboard's product surface is verified by **looking** (YATU): a real screenshot of the rendered
spec-graph board, captured through the running app and recorded as a reading. This is the tree's first
real **image** reading — evidence you open in the eval tab, not a `blob: null` placeholder.
