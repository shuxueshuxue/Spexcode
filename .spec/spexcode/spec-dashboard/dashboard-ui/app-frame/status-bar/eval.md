---
scenarios:
  - name: flow-row-does-not-cover-terminal
    tags: [frontend-e2e, desktop]
    description: >-
      At 1440px, open a live session's terminal face and wait for xterm to fit and render. Measure the app
      content row, sidebar, xterm screen and final xterm row against the status bar, then take settled full,
      lower-left-junction, and lower-right-junction screenshots.
    expected: >-
      The status bar is the final unshrinking full-window flow row after the app row. Rail and optional dock
      stop at its top edge; the bar starts at x=0 and ends at the viewport's right edge. The content row ends
      at the bar's top edge, and the xterm screen and its complete last rendered row end at or above that same
      edge; neither output nor caret is covered. The vertical sidebar/content and horizontal full-width
      content/status seams are single 1px `--line` strokes with a clean lower-left T junction and flush
      lower-right edge.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/StatusBar.jsx, spec-dashboard/src/styles.css]
  - name: project-identity-is-one-status-door
    tags: [frontend-e2e, desktop]
    description: >-
      Open a scoped dashboard through a real hub catalog. Inspect the rail and status DOM, open the compact
      project identity button, exercise an online project row and the global Projects row, and repeat with
      an offline catalog project and a project-only guest.
    expected: >-
      Exactly one project identity trigger exists and it is in the status row, showing a 14px project mark
      plus the visible project name; the rail has no project chip. The menu retains online same-tab links,
      visibly inert offline rows, current-project identity/check state, and a global `/projects` entry. A
      denied guest sees the same identity control as the login door but no catalog rows.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/SideBar.jsx, spec-dashboard/src/styles.css]
  - name: launcher-tally-complete-and-compact
    tags: [frontend-e2e, desktop]
    description: >-
      With multiple configured launchers and session records, inspect the settled status bar at 1440px and
      700px through the real dashboard. Include profiles sharing one harness icon, an unknown or missing
      launcher record, and at least one needs-you session; click the launcher tally from a non-sessions route.
    expected: >-
      The 1440px bar remains exactly one --line-status row and shows each non-empty configured launcher as a
      non-overlapping icon/name/running-needs-you-other group, plus one other bucket for unmatched records;
      no session is silently omitted and needs-you uses the existing sb-warning semantic token. At 700px the
      launcher list is replaced as one unit by a clickable aggregate badge with complete slash digits, the
      badge stays inside the viewport, shared-harness profiles remain distinguishable by their initials, and
      the click opens the sessions console without an unrelated archive-index error notice.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/StatusBar.jsx, spec-dashboard/src/styles.css]
    test: spec-dashboard/test/identity-chain.e2e.mjs
  - name: node-ledger-is-the-four-state-counts
    tags: [frontend-e2e, desktop]
    description: >-
      On any route in the running dashboard, enumerate the node ledger's controls on the settled status bar:
      count `[data-board-stat="drift"]`, `[data-board-stat="nodes-total"]`, `[data-board-stat^="status-"]`,
      and any `.sb-tally-sep` / `.sb-tally-lead` seam or lead element.
    expected: >-
      Exactly four state counts and nothing else: no drift door, no grand total, no tally separator. The
      total restated the sum of the four counts standing beside it and drift restated a warning the lint
      gate raises and the node's own chip carries, so both are withdrawn; the seam went with the door it
      separated, leaving the group border as the line's one divider voice. Zero loss = a quiet resting line
      whose every remaining number says something nothing else on screen already says.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/specMeta.js]
  - name: session-eval-door-rides-the-line-and-leaves-with-the-document
    tags: [frontend-e2e, desktop]
    description: >-
      Open a live session document in a real browser and locate `.si-eval-door`: inside `.statusbar` or
      inside `.tabstrip-actions`? Compare its rendered height with the status row's, and confirm the frame's
      own `.sb-item` wraps it. Then route to a spec document and count the door again — the Sessions view
      stays MOUNTED and display-hidden, so the count must come from the painted line.
    expected: >-
      The door is on the ambient line, absent from the action band, wrapped by the frame's sb-item, and no
      taller than one `--line-status` row; its href is still the canonical `scope:<id>` Evals address. On a
      non-session document the line carries no door at all — not a hidden one. A readout that survived the
      tab switch would be describing a document nobody has open. Zero loss = one door, on the line, for
      exactly as long as its session is the document being read.
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/statusOwnership.js]
---
# measuring the status bar

YATU: use a real Chromium page. Geometry claims come from settled DOM rectangles and a screenshot; project
switching claims come from the actual scoped gateway, catalog, and native links rather than a mocked menu.
