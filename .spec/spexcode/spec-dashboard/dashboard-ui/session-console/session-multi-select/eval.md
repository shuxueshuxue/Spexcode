---
scenarios:
  - name: right-click-select-enters-multi-select
    description: >
      On the session console (#/sessions), right-click a session row and pick "select…" from the
      context menu. The list should enter multi-select mode: the New/Search top row is replaced by a
      select bar reading "1 selected" with a "close" and "cancel" button, and the right-clicked row
      shows a ticked checkbox. Clicking other rows toggles their checkbox (and the count) instead of
      switching the right pane. Cancel leaves the mode untouched.
    expected: >
      The context menu carries three items (rename, select…, close). Choosing select… flips the list
      into a checklist pre-ticking the clicked row (count = "1 selected"); row clicks toggle picks
      without changing the selected terminal; the select bar's close is enabled only when ≥1 row is
      picked. The bulk button reads "close" (the same verb as the single-row menu), never "delete".
      Cancel restores the ordinary New/Search top row with nothing closed.
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
      after the board reload. Cancelling the confirm closes nothing.
    tags: [frontend-e2e]
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

Measured by driving the real dashboard (`npm run dev` in spec-dashboard) in a browser against a running
`spex serve` with a few live sessions: right-click a row, read the popped menu and the resulting select
bar / checkboxes from the live DOM, toggle picks, and run a bulk delete — comparing the on-screen result
to `expected`, never by reasoning about the source.
