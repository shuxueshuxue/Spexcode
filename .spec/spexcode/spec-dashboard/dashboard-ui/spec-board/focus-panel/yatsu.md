---
scenarios:
  - name: panel-shows-issues-and-scenarios
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard and focus a node that carries both an open issue and a scenario (e.g.
      spec-cli). Look at the RIGHT focus panel: it names the focused node, then a SCENARIOS section
      listing each declared scenario with a state mark, its name, and its `expected`, headed by a
      ✓ satisfied/total count; then an ISSUES section listing the open (and closed) issues as cards.
      Focusing a node with no yatsu.md shows a clean "no scenarios" empty state. Screenshot it and file
      with `spex yatsu eval focus-panel --image <png> --pass`.
    expected: >-
      The right panel renders the focused node's Scenarios (per-scenario state + expected, with a
      ✓X/Y count) AND its Issues (open/closed cards) together, with equal weight — the two stateful
      kinds of bound work in one surface. A node with no scenarios shows the empty state, not a blank.
    code:
      - spec-dashboard/src/FocusPanel.jsx
      - spec-dashboard/src/styles.css
---
# yatsu.md — focus-panel

Product surface, measured by **looking** (YATU): the agent opens the dashboard, focuses a node, and
screenshots the right panel showing that node's Issues and Scenarios side by side, filing it as a reading
with image evidence and a verdict. The scenario scopes its freshness `code:` to `FocusPanel.jsx` and its
stylesheet slice — not `App.jsx` (only the mount lives there) — so an unrelated App.jsx edit doesn't make
this reading stale. (This dogfoods the per-scenario `code:` axis it is itself measuring.)
