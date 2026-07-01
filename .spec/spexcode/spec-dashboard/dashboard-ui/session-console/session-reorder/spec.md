---
title: session-reorder
status: active
hue: 200
code:
  - spec-dashboard/src/sessionReorder.js
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
desc: Drag a session row by an explicit handle to reorder the list — a local pseudo-time override that never touches the row's click/double-click/focus.
---

# session-reorder

## raw source

The session list groups into two **triage zones** — *needs you* over *self-running* ([[session-console]]) —
and **within each zone the newest session sits on top** (descending effective time): the fresh, recently
touched work a human actually reaches for, not the oldest ([[sessions-core]]). That default is right until a
human wants a particular session pinned somewhere it wouldn't otherwise sort. They should be able to **drag a row** to where they want it,
but dragging must **never cost the row's other gestures**: a single click still switches to that tab, a
double-click still locks the board onto the session and jumps to its node, and clicking a row must keep
the **`❯` input focused**. The first attempt made the whole row draggable and stole all three — so the
drag lives behind an **explicit handle**, the one part of the row you grab to reorder.

## expanded spec

Reordering is a **pseudo-time** override, never a separate position index or a manual-mode flag. Each
session sorts by **one number** — its `sortKey` if it has one, else its real birth time (`created`) — so
the manual order and the default order live on the **same axis**. A drag rewrites **one** row's `sortKey`
to the **midpoint** of its two new neighbours (`(left + right) / 2`), or a step past the end one when
dropped at the very top or bottom; its neighbours keep their real birth time, so a later-born session
still slots in by `created`, flowing **around** the dragged row. Drag one row and exactly one row deviates;
reset it and the list is purely default again. A drag **pins within a zone** — the zone is derived from live
status, so dropping a row into another zone's band just snaps it back. Because the list is shown
**newest-first** within a zone, the write is **direction-aware**: the two-neighbour midpoint is
direction-agnostic, but dropping past an end (and the precision repair below) flip so the **top** row takes
the **largest** key. The lone exception is that **precision repair**: when a midpoint can no longer fall
strictly between two neighbours the whole list is **renormalised** onto an evenly spaced grid — a rare
automatic backstop, not the normal path.

The gesture is an **explicit drag handle** — a small grip at the **far right of the row's second line**
(the status/op line, `.sess-meta`), shown **only** in the console's interactive list ([[session-console]]),
never the read-only window glance ([[session-graph]]). **Only the handle starts a drag**: pressing it begins
a **pointer drag** (mousedown → window mousemove past a small threshold → mouseup), dropping on the upper or
lower half of a row places the dragged row **above** or **below** it, and releasing past the last row appends.
A pointer drag — not native HTML5 DnD — is the load-bearing choice: native DnD needs an un-preventDefaulted
mousedown, but the console preventDefaults a row mousedown to keep the `❯` input focused, and the two cannot
both win (besides, native DnD on a real mouse was unreliable here). A pointer drag rides `window`
mousemove/mouseup, which `preventDefault` does **not** stop, so the handle's mousedown flows through the
focus-retention **untouched** — the input keeps focus AND the drag works. Because only the handle starts a
drag, the rest of the row is **completely untouched** — single click switches tab, double-click locks, the
`↑/↓` ring walks the list, and a row click keeps the `❯` input focused.

The `sortKey` lives where the rest of a session's record lives — the session's record in the per-user global
store, written by the one backend that owns it ([[sessions-core]]) — so a reorder **persists** across a backend restart and is
read back like any other field. Every surface sorts on the same `sortKey ?? created` axis — zone-partitioned
and newest-first — so the manual order shows up **everywhere at once**: the [[session-console]] tabs and list, the top-left window, the relationship
[[session-graph]], and the CLI's `spex` listings all agree. It is **global state**, not a per-browser view.
Persisting follows the rename pattern — POST the new key, then ask the board to reload — **not** an optimistic
local shuffle, so the list always shows exactly what the backend reports.

**Resetting** a row back to birth order is the menu twin of a blank rename: the session row's right-click
menu ([[session-rename]]) carries a **reset order** item — shown only while that row actually has a `sortKey`
— that clears the override (POSTs a null key), dropping the row back to its `created` slot. A session in
**any** state is reorderable or resettable (queued, live, offline), because the gesture edits the on-disk
record, not the live terminal; reordering an unknown session fails loudly (the endpoint answers 404).
