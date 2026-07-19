---
title: session-multi-select
status: active
hue: 20
desc: Right-click → "select" turns the session list into a multi-select mode with checkboxes and one bulk "close" that closes every picked session at once.
code:
  - spec-dashboard/src/SessionSelectBar.jsx
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/styles.css
---

# session-multi-select

## raw source

The row right-click closes sessions **one at a time** ([[session-rename]]), which is the wrong tool when a
run of finished or dead worktrees has piled up and a human wants them all gone. Closing ten sessions means
ten right-clicks, ten confirms. So the same right-click that renames or closes a single row also offers
**select** — it flips the session list into a **multi-select mode** where rows are checkboxes, not tabs, and
one bulk **close** removes every picked session at once, behind one confirm.

## expanded spec

**Select** is the context menu's third verb, beside rename and close ([[session-rename]]). Picking it enters
**multi-select mode** on the board's left-hand session list ([[session-console]]) and **pre-selects the row
that was right-clicked** — the human reached for that row, so it starts already ticked, and one more close
would remove just it. Entering the mode is the only new job the menu item does; everything else is the mode.

In multi-select mode the list stops being a tab picker and becomes a **checklist**. Every session row shows a
checkbox and a **click toggles that row's pick** instead of switching the right pane — the terminal you were
watching stays put, because ticking sessions to remove must never yank you onto a different one. The
right-click session menu is **suppressed** while selecting (the gesture that opens single-row actions
would fight the bulk one), so its lock-on-graph action is unavailable too. Zone grouping and ordering are unchanged —
the mode only reinterprets a row's clicks, it does not reshuffle the list.

The list's top button row is **replaced, while selecting, by a select bar**: a live **count of picked
sessions**, a **close** action, and a **cancel** that leaves the mode without touching anything. The bulk
action is deliberately named **close**, the SAME verb the single-row menu uses ([[session-rename]]) — NOT a
third "delete" word — because the model has only two session verbs: `close` (remove the worktree + branch,
discard the work) and `exit` (the soft stop that keeps the worktree, [[session-console]]). Bulk close is just
`close` applied to many rows, so it must read `close` or it invents a concept the system doesn't have. It is
**destructive** — wearing the same orange as the single-row close — and **disabled at zero picks** (there is
nothing to remove). It closes **every picked session** exactly as the single close does: worktree + branch
gone, the work discarded, per session. Because the removal is destructive and bulk, close opens **one
confirm** naming **how many** sessions will go — not one prompt per session — and only the confirm commits.

Confirming **dismisses the prompt at once** and fires **all** the closes in the **background** — the same
fire-and-forget the single close and the New Session launch use ([[session-console]]), never a frozen dialog
watching N worktree removals run — then leaves multi-select mode and asks the board to reload, so the closed
rows drop off every surface together. A close that fails is reconciled by the next board poll, never a silent
success. Cancelling, or pressing Esc, leaves the mode with nothing closed.

The bulk-close bar and its confirm are this node's own surface (`SessionSelectBar.jsx`); the mode's state
(which rows are picked, whether selecting is on) and the row's toggle-instead-of-switch behaviour live in the
list that owns the rows ([[session-console]]'s `SessionInterface`), and the menu item that turns the mode on
is a one-line hook into the right-click menu ([[session-rename]]'s `SessionContextMenu`). Each session is
removed through the very endpoint the single close already calls, so bulk close inherits its exact semantics
rather than inventing a second removal path.
