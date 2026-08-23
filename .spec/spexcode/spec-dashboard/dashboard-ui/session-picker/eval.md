---
scenarios:
  - name: picker-is-one-session-choice-language
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/source-selection.e2e.mjs
    description: >-
      Open the real source-selection send popover, inspect its target control, then open the graph node
      context menu on a node with a live overlay. Exercise filtering and keyboard selection in the picker,
      and click the overlay row.
    expected: >-
      No native `pa-select` remains. The send popover, mentions session rows, and node menu rows use the
      shared avatar + handle + status-glyph vocabulary. Arrow navigation and Enter choose one id; the node
      menu choice closes the menu and writes the canonical `#/sessions/<id>` route.
---
Measure through the dashboard in a real browser. Capture the compact graph badge and the expanded picker,
the send popover picker, and the node-menu route after choosing an overlay session.
