---
scenarios:
  - name: door-is-an-anchor-and-spins-only-while-a-value-arrives
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionInterface.jsx#SessionEvalStats]
    description: >
      Select a session with measured evals, read the door's href, accessible name, and tallies; trigger an input
      event and read the transition; disconnect the graph stream; select a retained offline (dormant) session and a
      closed one.
    expected: >
      The href is the canonical session-scoped Evals address; the four tallies sum to the affected declarations with
      no second aggregate; `updating` shows beside last-known counts, never zero; the spinner appears only for
      loading/updating; dormant and closed show last-known counts or a blind-spot mark with the door named as the
      way to measure — and no summary request of the console's own is made.
---
# measuring eval-door

The door is read as an anchor and a state machine; its numbers are cross-checked against the scoped Evals list.
