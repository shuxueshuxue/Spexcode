---
scenarios:
  - name: panel-shows-issues-and-scenarios
    tags: [frontend-e2e, desktop]
    description: >-
      Open the dashboard and focus a node that carries both an open issue and a scenario (e.g.
      spec-cli). Look at the RIGHT focus panel: it names the focused node, then a SCENARIOS section
      listing each declared scenario with a state mark, its name, and its `expected`, headed by a
      ✓ satisfied/total count; then an ISSUES section listing the open (and closed) issues as cards.
      Focusing a node with no yatsu.md shows a clean "no scenarios" empty state. Click one scenario row
      and confirm the app routes to `#/evals/<node>/<scenario>` with that eval selected; click one issue
      card and confirm the app routes to `#/issues/<issue-id>` with that issue selected. Screenshot it and
      file with `spex yatsu eval focus-panel --image <png> --pass`.
    expected: >-
      The right panel renders the focused node's Scenarios (per-scenario state + expected, with a
      ✓X/Y count) AND its Issues (open/closed cards) together, with equal weight — the two stateful
      kinds of bound work in one surface. A node with no scenarios shows the empty state, not a blank.
      Scenario and issue clicks use the shared app address route and land on their owning Evals/Issues
      detail pages, not on the node popup.
    code:
      - spec-dashboard/src/FocusPanel.jsx
      - spec-dashboard/src/IssueCard.jsx
      - spec-dashboard/src/Dashboard.jsx
      - spec-dashboard/src/route.js
      - spec-dashboard/src/styles.css
---
# yatsu.md — focus-panel

Product surface, measured by **looking** (YATU): the agent opens the dashboard, focuses a node, and
screenshots the right panel showing that node's Issues and Scenarios side by side, then clicks a scenario
and an issue through the real page to prove both land on their routed detail addresses, filing it as a
reading with image evidence and a verdict. The scenario scopes its freshness `code:` to the focus-panel
interaction chain — FocusPanel, IssueCard, Dashboard's address callback, and route.js — plus the stylesheet
slice, so unrelated shell edits do not stale this reading. (This dogfoods the per-scenario `code:` axis it
is itself measuring.)
