---
scenarios:
  - name: band-budget-holds
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/test/band-budget.e2e.mjs]
    test: spec-dashboard/test/band-budget.e2e.mjs
    description: >-
      Drive the running dashboard in a real desktop browser (1440x900) through a representative traversal
      of the workspace state space: every route kind (graph, evals, issues, settings, empty, spec, file,
      session) against every left-dock value (closed, explorer, sessions), the right-context axis doubled
      on the spec document that owns it, both session surfaces a probe can guarantee (terminal,
      conversation), and a split state. Drive the axes through the real product — seeded workspace state
      plus real addresses — and boot each state from a workspace address before entering a bare review
      board, since a FIRST load at #/evals or #/issues renders the cold review fast-path, a different and
      dockless shell. In each settled state, classify the chrome bands the DOM actually renders and
      compare the count to B(state) = rail + dock + 1(tabstrip) + 1(statusbar) + context, where the bare
      Issues board has rail=0 and every other route has rail=1. Overlays,
      resize handles and anything inside a declared vertical scrollport are not bands; sibling rows inside
      one region each count.
    expected: >-
      Every visited state stacks exactly the bands its budget allows, and the enumerated state space holds
      2 ≤ B ≤ 5 end to end. The representative pressure set wraps real session tabs on document/session
      routes; resident board routes intentionally retain one board tab and report their single-row state.
      No region carries a row the model does not name: the dock is ONE band (no mode
      row above its header, no archive footer below its list), the tab row is ONE band including its
      wrapper, a session is its tab bar and nothing more, and a document view adds no picker or footer row
      of its own. Zero loss = the frame costs the same small, countable number of rows in every state a
      reader can reach, so "no stacking layer upon layer" is a gate rather than a preference. A failure
      prints the offending states ranked by excess with each measured band's class and pixel size, which
      is the repair list.
---
# ui-state-model — measurement

YATU: measure through the running dashboard in a real browser, never by reading the JSX. A band is a fact
about rendered geometry — what a wrapper contributes depends on its computed flex, its position, and
whether a scrollport sits above it, none of which survive a source reading. Point the probe at a live dev
server or gateway and let it walk the traversal:

    BASE=<dashboard url> node spec-dashboard/test/band-budget.e2e.mjs

It exits nonzero on any breach and writes a screenshot per failing state, so the reading is filed against
what the browser actually painted. `BAND_SURFACES=all` adds the diff and resource surfaces, which need
backend state the probe cannot guarantee on its own.
