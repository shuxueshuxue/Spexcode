---
scenarios:
  - name: rail-owns-dock-projection-cycle
    description: >-
      In the running desktop dashboard, click the rail's Explorer and Sessions projection buttons through
      the three states: explorer open, dock closed, and sessions open. Reload, then inspect the persisted
      projection and verify the dock has no modebar.
    expected: >-
      Explorer is initially pressed with the dock open; clicking it closes the dock and clears both pressed
      states; clicking Sessions reopens the dock in sessions mode and presses only Sessions. Reload preserves
      the open sessions projection. The dock begins directly with its EXPLORER count head or sessions list
      head, and `.dock-modebar` never renders. No document hash changes during the cycle.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/Dock.jsx, spec-dashboard/src/workspace.jsx]
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
