---
scenarios:
  - name: drag-reorder-local
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      three live sessions in their default birth order — read top→bottom as A (oldest), B, C (newest).
      Screenshot the tab list as the baseline. Then DRAG A's row down and drop it in the lower half of
      C's row (below C). Screenshot the tab list again. Then force a board reload (refresh the page, or
      let the poll round-trip) and screenshot once more to prove the new order is persisted server-side,
      not a browser-only shuffle. Cross-check the top-left SessionWindow glance shows the SAME order as
      the console list.
    expected: |
      After the drag the list reads B, C, A — ONLY the dragged row moved; B and C kept their relative
      birth order and were not rewritten. The new order SURVIVES the reload (it is persisted to the
      session's `.session` record as a `sortKey`, read back like any other field), and the top-left
      window glance shows the identical B, C, A order — every surface sorts by the same `sortKey ?? created`.
      The other row gestures still work (single-click switches tab, right-click opens the menu); the drag
      is additive, not a replacement.
  - name: drag-coexists-with-click-and-dblclick
    description: >
      Through the running dashboard in a real browser, open the console (Enter) with several sessions, at
      least one carrying pending ops (so double-click has a node to focus). With a REAL mouse, exercise the
      three row gestures and confirm they stay distinct now that rows are draggable: (1) a single click
      switches to that session's tab; (2) a double-click locks the board onto the session and jumps to its
      focused node (the console closes onto the board — onPickSession); (3) a press-and-drag reorders the
      row. This guards the regression where a hand-rolled pointer drag cannibalised the double-click.
    expected: |
      All three coexist and none cannibalises another: a single click selects the tab, a double-click locks
      and focuses the node (closing the console onto the board), and a drag reorders the list. A double-click
      never reorders, and a drag never switches or locks. The split is the browser's own — rows are native
      HTML5 `draggable` and keepFocus exempts `.si-item` so a real dragstart fires, while click and dblclick
      stay native and untouched.
  - name: reset-restores-birth-order
    description: >
      Continuing from a list where one row has been dragged out of birth order (e.g. A sits at the bottom
      after drag-reorder-local), right-click the moved row to open its context menu and confirm it now
      offers a "reset order" item (the item is absent on a row that was never dragged). Pick it.
      Screenshot the menu before and the tab list after.
    expected: |
      The right-click menu on a dragged row carries a "reset order" item alongside rename/close; on a row
      with no manual override that item is not shown. Choosing it clears the `sortKey` (POSTs a null key)
      and the row drops straight back to its birth slot — A returns to the TOP of the list — with the rest
      of the list unchanged. The reset reflects on every surface after the board reload, the same way a
      blank rename clears a name.
---

# session-reorder — yatsu

Measure through the **real dashboard surface**, YATU-style: open the console with `Enter` and drag the
actual session rows in the browser, never a direct `POST /api/sessions/:id/sort` call or an internal
reorder helper. The loss being scored is the **local pseudo-time** contract in the spec: a drag moves
exactly the dragged row (its `sortKey` set to the midpoint of its new neighbours), every untouched row
keeps its real birth time, and the order persists across surfaces and restarts because it is stored in
`.session`, not the browser. Evidence is a before/after screenshot pair of the tab list (plus the
top-left window glance for the cross-surface check).
