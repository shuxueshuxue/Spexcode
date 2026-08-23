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
  - name: session-badge-geometry
    tags: [frontend-e2e, desktop]
    description: >-
      Open the real graph in Chromium at 1440x900 and the narrow desktop breakpoint 641x320. Inspect the
      compact right-top SessionWindow count/avatar badge at rest, open it, and inspect the expanded shared
      SessionPicker. Record the rendered rectangles, viewport margins, first-row geometry, and horizontal
      overflow from the live DOM.
    expected: >-
      The count/avatar badge is a bounded top-right glance control: 10px from the graph's top and right edges,
      26px tall, with no horizontal overflow. Its expanded shared picker stays 10px from the viewport right
      edge, is 250px wide, begins 5px below the trigger, and exposes the same compact picker rows (238px by
      25px inside the panel) at both tested desktop widths.
---
Measure through the dashboard in a real browser. Capture the compact graph badge and the expanded picker,
the send popover picker, and the node-menu route after choosing an overlay session.
