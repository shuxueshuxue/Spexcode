---
scenarios:
  - name: right-click-select-enters-multi-select
    description: >
      On the session console (#/sessions), right-click a session row and pick "select…" from the
      context menu. The list should enter multi-select mode: the New/Search top row is replaced by a
      select bar reading "1 selected" with an icon-only close tool plus a cancel control,
      and the right-clicked row shows a ticked checkbox while its full body remains the drag surface. Clicking other rows toggles
      their checkbox (and the count) instead of switching the right pane. Cancel leaves the mode
      untouched.
    expected: >
      The context menu carries rename, select…, and close. Choosing select… flips the list into a checklist
      pre-ticking the clicked row (count = "1 selected"); row clicks toggle picks without changing the selected
      terminal; close is enabled only when ≥1 row is picked and its accessible icon label names the action.
      Cancel restores the ordinary New/Search top row with nothing changed.
    tags: [frontend-e2e]
  - name: bulk-close-confirm-and-close
    description: >
      In multi-select mode with two or more rows picked, click "close". A single confirm modal should
      appear naming the count ("close N sessions?"). Confirming dismisses the modal at once and closes
      every picked session (each via POST /api/sessions/:id/close), then the list leaves multi-select
      mode and the removed rows drop off the board on reload.
    expected: >
      One confirm modal (not one per session) titled "close N sessions?"; confirming fires all closes
      in the background, exits multi-select mode, and the closed rows disappear from every surface
      after the board reload. A refused close reports the backend reason through the session action outcome
      while the rejected row remains visible. Cancelling the confirm closes nothing.
    tags: [frontend-e2e]
  - name: drag-reparent-and-close-danger
    description: >
      In multi-select mode, primary-pointer drag a session row from its body (not a grip) onto a different session row, then leave
      the mode and open the bulk close confirm. Press Enter and verify that no lifecycle request was made before
      the confirm opened, then count the resulting requests.
    expected: >
      A short row click still changes only its check; after the movement threshold the source row dims, its
      full-row ghost keeps the source title, checkbox, fold pod, and live status, floats clear of the highlighted
      drop target, and the drag sends exactly one
      POST /api/sessions/reparent with the dragged id in children and the drop target as parent; no local tree
      mutation stands in for that request. Bulk close opens one confirm whose destructive commit button is
      focused, so Enter closes that dialog and sends exactly one close request per selected row, then leaves
      multi-select mode. Escape, Cancel, and a backdrop click still cancel without a lifecycle request.
    tags: [frontend-e2e, backend-api, desktop]
    test: "spec-dashboard/test/session-multi-select.e2e.mjs"
  - name: nested-count-moves-with-selectable-row
    test: spec-dashboard/test/session-multi-select.e2e.mjs
    description: >
      On the session console, inspect a collapsed parent row whose leading count represents nested
      sessions, then enter multi-select mode from that row's context menu and compare the checkbox,
      count pod, and headline geometry before and after the mode change.
    expected: >
      Entering multi-select inserts the checkbox at the row's leading edge and shifts the complete
      existing row face to the right by one consistent offset: the nested-session count pod and the
      headline move together, preserving their gap and alignment. The count never stays behind while
      only the headline moves, and no control overlaps at the narrow 204px default sidebar width.
    tags: [frontend-e2e, desktop]
---

Measured by driving the real dashboard in a browser against an isolated running `spex serve` with a few
live sessions: right-click a row, read the popped menu and the resulting select bar / checkboxes from the
live DOM, drag the rendered row body, and open the close confirmation — comparing the on-screen
result and outgoing reparent payload to `expected`, never by reasoning about the source.
