---
scenarios:
  - name: sessions-dock-is-the-one-list
    description: >-
      Through the running desktop dashboard, open the sessions dock projection, inspect its real rendered
      forest rows and status glyphs, then click a session row and the `+` New Session door. Inspect the routed
      session document after each navigation, and open the bottom archive door.
    expected: >-
      The dock is the only desktop session list: rows follow the session forest hierarchy, show status glyphs,
      and highlight the route-selected session. A plain row click navigates in place and ctrl/command-click
      holds a tab. The `+` door reaches `#/sessions/new`; the archive door opens the existing document overlay.
      On `#/sessions/<id>` and `#/sessions/new`, the document contains no `.si-list`, `.si-board-scroll`, list
      resizer, or collapsed stub; the terminal or timeline fills the complete document width. No drag or
      multi-select affordance appears in the read-only dock.
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/Dock.jsx
      - spec-dashboard/src/SessionInterface.jsx
      - spec-dashboard/src/SessionsView.jsx
---

Measure through the running dashboard in a real desktop browser (YATU). Use settled screenshots for the dock
forest, New Session document, and archive overlay, plus DOM geometry as supporting evidence that the terminal or
timeline owns the full holding region. The dock is finding; session content remains holding, in line with the
workspace-shell four-region model.
