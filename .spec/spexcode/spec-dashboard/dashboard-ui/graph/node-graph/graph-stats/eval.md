---
scenarios:
  - name: whole-tree-composition
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/plugin-node.e2e.mjs
    description: >-
      Open the workspace and inspect the shell's node tally against the complete graph payload.
    expected: >-
      The shell ledger starts with the complete tree's node count. Its mutually exclusive status-dot counts sum to
      that same total; paths, including `.plugins`, create no separate presentation category.
  - name: stats-strip-renders
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard and let the board settle. The shell-owned status ledger should read the whole-tree
      total, then the four status dots
      (●merged ●active ●drift ●pending) each with a count, then ⚠ drift-node
      and ◆ open-issue counts, then the yatsu score circles. Confirm the figures are COUNTS of
      distinct things: the whole-tree total equals the four status-dot counts summed, and ◆ is
      the DEDUPED distinct open-issue count (not the per-node sum — an issue on several nodes counts
      once). Confirm the yatsu score circles count SCENARIOS, not nodes — cross-check a coverage
      chip's number against the per-scenario tally (a node with several scenarios contributes each;
      a never-measured scenario shows under the empty blind-spot ring), so the coverage figures are
      larger than a one-verdict-per-node roll-up. Confirm a stale score uses a dashed outer ring while its
      check/cross preserves the last verdict. Capture the ledger and file with
      `spex eval add graph-stats --scenario stats-strip-renders --image <png> --pass`.
    expected: >-
      The one shell ledger renders all three clusters; its whole-tree total equals the four status-dot counts summed;
      ◆ is the deduped distinct open-issue count; the coverage circles
      count scenarios (not nodes), so their figures match the per-scenario tally and exceed a
      per-node roll-up; stale and fresh verdicts have different outer-ring geometry. The filed reading
      carries the screenshot as image evidence and a pass verdict.
  - name: stat-click-jumps
    tags: [frontend-e2e, desktop]
    description: >-
      With the dashboard open, click a non-zero stat chip whose ring has more than one node (e.g.
      the ⚠ drift chip) REPEATEDLY. Each click should step focus to the NEXT node that chip counts —
      its spine drills open and the camera pans to centre it — cycling through them all and wrapping
      back to the first; a zero-count chip stays dimmed and inert. Record the focused node after each
      click, capture the graph, and file with `spex eval add graph-stats --scenario
      stat-click-jumps --image <png> --pass`.
    expected: >-
      Repeated clicks on a multi-node chip walk focus through each distinct node it counts and wrap
      at the end (not stuck on the first); a zero-count chip does not respond. The filed reading
      carries the screenshot as image evidence and a pass verdict.
  - name: shell-owns-one-board-ledger
    tags: [frontend-e2e, desktop]
    description: >-
      At a 1440px viewport, open the graph so its keep-mounted document enters the pool, then switch to
      another workspace route. Inspect the status bar DOM and rendered geometry; return to the graph and
      repeatedly click a non-zero status, drift, issue, and eval category.
    expected: >-
      The right status group contains one shell-owned board ledger: each node, issue, and eval number appears
      once even after the graph has been mounted and hidden; no graph-stats status item remains; fresh and
      stale eval states have different icon geometry; the complete right group is at most 480px wide; and
      category clicks on the graph still walk the counted nodes in order and wrap without losing any tally.
---
# eval.md — graph-stats

The ledger is a product surface measured by **looking** (YATU): the agent drives the running dashboard,
screenshots the rendered status bar, and checks the arithmetic it promises — its whole-tree
total equals the four status-dot counts summed, ◆ is the *deduped* distinct open-issue count, and a
stale score has a dashed ring distinct from a current verdict — then confirms that repeatedly clicking a multi-node chip
*walks* focus through every node it counts and wraps. Both readings are image evidence with a verdict, not
a `blob: null` placeholder.

The shell-ownership repair is measured through the whole workspace rather than an isolated graph paint:
mount the graph, switch away while it remains pooled, and inspect the one status bar a user sees. The DOM
proves ownership and icon identity; rendered rectangles prove the width bound; repeated graph clicks prove
that consolidating the ledger did not discard navigation.
