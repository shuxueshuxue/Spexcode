---
scenarios:
  - name: stats-strip-renders
    description: >-
      Open the dashboard at http://localhost:5173 and let the spec-graph settle. Look at the
      bottom-left: a board-stats strip should read the whole-tree totals — a leading node count,
      the four status dots (●merged ●active ●drift ●pending) each with a count, then ⚠ drift and
      ◆ open-issue totals, then the yatsu score circles (✓ ✗ ⊘). Confirm the leading total is a
      plausible tree size (tens of nodes, not 0) and the four dot counts sum to it. Capture the
      strip and file it with `spex yatsu eval board-stats --image <png> --pass`.
    expected: >-
      The bottom-left strip renders all three clusters (composition dots + counts, ⚠/◆ attention,
      score circles); the leading total is non-zero and equals the sum of the four status-dot
      counts. The filed reading carries the screenshot as image evidence and a pass verdict.
  - name: stat-click-jumps
    description: >-
      With the dashboard open, click a non-zero stat chip in the strip (e.g. the ●merged dot or
      the ⚠ drift chip). The board should focus the first node that chip counts — its spine drills
      open and the camera pans to centre it. Capture the board after the jump settles and file it
      with `spex yatsu eval board-stats --image <png> --pass`.
    expected: >-
      Clicking a non-zero stat chip focuses and centres the first node it counts (spine expanded,
      camera panned); a zero-count chip is dimmed and does not respond. The filed reading carries
      the screenshot as image evidence and a pass verdict.
---
# yatsu.md — board-stats

The strip is a product surface measured by **looking** (YATU): the agent drives the running dashboard,
screenshots the rendered bottom-left strip, and checks the cheap arithmetic the strip promises — the
leading total equals the four status-dot counts summed — then confirms a chip click jumps the board to
the first node it counts. Both readings are image evidence with a verdict, not a `blob: null` placeholder.
