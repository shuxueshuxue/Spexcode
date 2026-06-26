---
scenarios:
  - name: handle-drag-reorders
    description: >
      Through the running dashboard in a real browser, open the session console (Enter) with at least three
      live sessions in birth order — read top→bottom as A (oldest), B, C (newest). Each row shows a small
      drag handle at the far right of its second line. With a REAL mouse, grab A's handle and drop it on the
      lower half of C's row (below C). Screenshot before and after, then force a board reload and screenshot
      once more to prove the order persisted server-side.
    expected: |
      After the drag the list reads B, C, A — ONLY the dragged row moved; B and C kept their relative birth
      order. The new order SURVIVES the reload (persisted to the session's `.session` record as a `sortKey`).
      The drag handle appears only in the console's interactive list, not the read-only top-left window glance,
      and the manual order shows on every surface (window + console agree), all sorting by `sortKey ?? created`.
  - name: handle-leaves-row-gestures-intact
    description: >
      Through the running dashboard in a real browser, open the console with several sessions (at least one
      carrying pending ops so double-click has a node to focus). Without touching the handle, exercise the
      row's own gestures with a real mouse: (1) single-click a row — it switches to that tab AND the `❯`
      input stays focused; (2) double-click a row with ops — it locks the board onto the session and jumps to
      its node (the console closes onto the board). Then confirm the handle still reorders (grab it, drag).
      This is the contract the first (handle-less) attempt broke.
    expected: |
      A single click switches the tab and the `❯` box KEEPS focus (document.activeElement is the input, not
      lost) — clicking a session never steals focus. A double-click on a row with ops locks + focuses its node
      (onPickSession, console closes onto the board). Dragging the handle still reorders. None of the three
      cannibalises another: the handle owns dragging, the row body owns click/double-click/focus, because only
      the handle is draggable and it stops its own mousedown so the row's focus-retention is never disturbed.
---

# session-reorder — yatsu

Measure through the **real dashboard surface**, YATU-style: open the console with `Enter` and drive the
actual session rows in the browser — grab the real drag handle, click and double-click the real row body —
never a direct `POST /api/sessions/:id/sort` call or an internal helper. The loss is the spec's two
contracts: a handle drag moves exactly the dragged row (its `sortKey` set to the midpoint of its new
neighbours) and persists across surfaces; and the handle costs the row **nothing** — click still switches
tab and keeps the `❯` input focused, double-click still locks and focuses the node. Evidence is a
before/after screenshot pair of the tab list plus the focus/lock checks.
