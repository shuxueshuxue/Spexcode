---
scenarios:
  - name: locked-banner-projects-current-cycle-keys
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/lock-hint.e2e.mjs
    description: >-
      In a Chromium browser running the real dashboard, use a graph projection based on the live backend
      response with a controlled session overlay so the non-empty lock population is reproducible. Open the
      bounded SessionWindow badge, then claim the same session from the full dock row. With two changed nodes, inspect the rendered top-centre
      banner and its keycaps, then click its visible release control. Reload with the same locked session
      changing one node and lock it again.
    expected: >-
      The two-node lock banner visibly names the selected session and displays the current forward and
      reverse overlay-cycle keys exactly as `o` and `O`; clicking release removes the banner and unlocks
      the row. The single-node banner still names that session and says it changed one node, but displays
      no cycle keycaps. This is browser evidence from the dashboard the reader uses, not a helper-unit
      assertion or a CLI/store reading.
    code:
      - spec-dashboard/src/lockHint.js
    related:
      - spec-dashboard/src/Shell.jsx
      - spec-dashboard/src/GraphView.jsx
      - spec-dashboard/test/lock-hint.e2e.mjs
---
# lock-hint — measuring the loss

The browser is the oracle: drive the visible SessionWindow badge/dock row and read the rendered lock banner. The
controlled graph input only creates the otherwise optional live-overlay population; it does not replace
the dashboard, its lock interaction, or its rendered user interface.
