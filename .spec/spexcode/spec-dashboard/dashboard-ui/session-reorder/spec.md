---
title: session-reorder
status: active
hue: 200
code:
  - spec-dashboard/src/sessionReorder.js
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
desc: Drag a session row to reorder the list — a local pseudo-time override, not a wholesale manual mode.
---

# session-reorder

## raw source

The session list is ordered by **birth time** (oldest first, a new session appends) — a stable spatial
map a human learns by muscle memory ([[sessions-core]]). That default is right until a human wants a
particular session somewhere it wasn't born: the one they keep coming back to pinned near the top, two
related sessions sat next to each other. They should be able to **drag a row** to where they want it —
but the drag must not flip the whole list into a frozen manual order. Everything they *didn't* touch
should keep flowing by time, and a freshly launched session should still slot in by its birth, not pile
up wherever the manual list happens to end.

## expanded spec

Reordering is a **pseudo-time** override, never a separate position index or a manual-mode flag. Each
session sorts by **one number** — its `sortKey` if it has one, else its real birth time (`created`) —
so the manual order and the default order live on the **same axis** and never need reconciling. A row
with no `sortKey` is exactly where birth put it; a row that was dragged carries a `sortKey` that places
it among its neighbours.

This is what makes the override **local, not wholesale**: dragging a row computes a `sortKey` for **that
row only** — the **midpoint** of its two new neighbours' sort values (`(left + right) / 2`), or a fixed
step past the end one when dropped at the very top or bottom. Its neighbours are **not** rewritten, so
they keep their real birth time and a session born later still falls into place by `created`, flowing
**around** the dragged row rather than being pinned by it. Drag one row and exactly one row deviates
from birth order; drag it back and the list is purely default again. The only time the whole list is
rewritten is the **precision repair**: bisecting the same gap dozens of times exhausts floating-point
headroom, so when a midpoint can no longer fall strictly between its neighbours the list is **renormalised**
onto an evenly spaced grid — a rare, automatic backstop, not the normal path.

The `sortKey` lives where the rest of a session's record lives — the worktree's `.session` file, written
by the one backend that owns it ([[sessions-core]]) — so a reorder **persists** across a backend restart
and is read back like any other field, never held only in the browser. Because every surface sorts by the
same `sortKey ?? created`, the manual order shows up **everywhere at once**: the [[session-console]] tabs
and its list, the top-left window, the relationship [[session-graph]], and the CLI's `spex` listings all
agree. It is **global state**, not a per-browser view — the deliberate cost of keeping one spatial map
that every surface and every agent shares.

The gesture is a **drag** on a session row in the console's **left-hand list** ([[session-console]]) —
the interactive surface, never the read-only glance. Dropping in the top or bottom half of a row places
the dragged row **above** or **below** it; dropping past the last row appends. The drag is **additive**
to the existing row gestures: single-click still switches tab, double-click still locks, right-click still
opens the menu, and the `↑/↓` keyboard ring is untouched. Persisting is the rename pattern — POST the new
key, then ask the board to reload so the new order paints on every surface — **not** an optimistic local
shuffle, so the list always shows exactly what the backend reports ([[session-console]] is a thin view of
`/api/board`).

**Resetting** a row back to birth order is the menu twin of a blank rename: the session row's right-click
menu ([[session-rename]]) carries a **reset order** item — shown only while that row actually has a
`sortKey` — that clears the override (POSTs a null key), dropping the row back to its `created` slot. A
session in **any** state is reorderable or resettable (queued, live, offline), because the gesture edits
the on-disk record, not the live terminal; reordering an unknown session fails loudly (the endpoint
answers 404), never a silent success.
