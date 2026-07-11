---
scenarios:
  - name: stats-strip-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard at http://localhost:5173 and let the spec-graph settle. Look at the
      bottom-left: a board-stats strip should read the whole-tree counts — a leading node total,
      the four status dots (●merged ●active ●drift ●pending) each with a count, then ⚠ drift-node
      and ◆ open-issue counts, then the yatsu score circles. Confirm the figures are COUNTS of
      distinct things: the leading total equals the four status-dot counts summed, and ◆ is the
      DEDUPED distinct open-issue count (not the per-node sum — an issue on several nodes counts
      once). Confirm the yatsu score circles count SCENARIOS, not nodes — cross-check a coverage
      chip's number against the per-scenario tally (a node with several scenarios contributes each;
      a never-measured scenario shows under the empty blind-spot ring), so the coverage figures are
      larger than a one-verdict-per-node roll-up. Confirm a stale score reads as the greyed verdict
      INSIDE the ring (grey ✓ / grey ✗), never an invented glyph. Capture the strip and file with
      `spex yatsu eval board-stats --scenario stats-strip-renders --image <png> --pass`.
    expected: >-
      The strip renders all three clusters; the leading total equals the four status-dot counts
      summed; ◆ is the deduped distinct open-issue count; the coverage circles count scenarios (not
      nodes), so their figures match the per-scenario tally and exceed a per-node roll-up; a stale
      score shows the greyed verdict mark inside the ring (no ⊘ or other invented glyph). The filed
      reading carries the screenshot as image evidence and a pass verdict.
  - name: stat-click-jumps
    tags: [frontend-e2e, desktop]
    description: >-
      With the dashboard open, click a non-zero stat chip whose ring has more than one node (e.g.
      the ⚠ drift chip) REPEATEDLY. Each click should step focus to the NEXT node that chip counts —
      its spine drills open and the camera pans to centre it — cycling through them all and wrapping
      back to the first; a zero-count chip stays dimmed and inert. Record the focused node after each
      click, capture the board, and file with `spex yatsu eval board-stats --scenario
      stat-click-jumps --image <png> --pass`.
    expected: >-
      Repeated clicks on a multi-node chip walk focus through each distinct node it counts and wrap
      at the end (not stuck on the first); a zero-count chip does not respond. The filed reading
      carries the screenshot as image evidence and a pass verdict.
---
# eval.md — board-stats

The strip is a product surface measured by **looking** (YATU): the agent drives the running dashboard,
screenshots the rendered bottom-left strip, and checks the arithmetic the strip promises — the leading
total equals the four status-dot counts summed, ◆ is the *deduped* distinct open-issue count, and a stale
score is the greyed verdict inside the ring — then confirms that repeatedly clicking a multi-node chip
*walks* focus through every node it counts and wraps. Both readings are image evidence with a verdict, not
a `blob: null` placeholder.
