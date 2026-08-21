---
title: session-multi-select
status: active
hue: 20
desc: Right-click → "select" turns the session list into a multi-select mode with checkboxes, compact bulk close controls, and whole-row drag-to-reparent.
code:
  - spec-dashboard/src/SessionSelectBar.jsx
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/session-multi-select.e2e.mjs
---

# session-multi-select

## raw source

The row right-click closes sessions **one at a time** ([[session-rename]]), which is the wrong tool when a
run of finished or dead worktrees has piled up and a human wants them all gone. Closing ten sessions means
ten right-clicks, ten confirms. So the same right-click that renames or closes a single row also offers
**select** — it flips the session list into a **multi-select mode** where rows are checkboxes, not tabs, and
bulk **close** can act on every picked session behind one confirm. The same mode also makes the
session tree editable: dragging a whole row onto another row makes it that row's child.

## expanded spec

**Select** is the context menu's third verb, beside rename and close ([[session-rename]]). Picking it enters
**multi-select mode** on the board's left-hand session list ([[session-console]]) and **pre-selects the row
that was right-clicked** — the human reached for that row, so it starts already ticked, and one more close
would remove just it. Entering the mode is the only new job the menu item does; everything else is the mode.

In multi-select mode the list stops being a tab picker and becomes a **checklist**. Every session row shows a
checkbox and a **click toggles that row's pick** instead of switching the right pane — the terminal you were
watching stays put, because ticking sessions to remove must never yank you onto a different one. The same
whole row uses the console's ordinary primary-pointer drag: a short click remains a pick, while a drag past the
movement threshold fades the source and carries its full-row ghost to a receiving row or the top-level drop
zone. Dropping it onto another session asks the existing `POST /api/sessions/reparent` authority to make the
dragged session a child of that target. The browser never mutates a tree locally: cycle, self-parent, and concurrent-state
refusals are backend results shown through the normal action outcome, and a successful request reloads the
board's derived forest. The right-click session menu is **suppressed** while selecting (the gesture that opens
single-row actions would fight the bulk one), so its lock-on-graph action is unavailable too. Zone grouping and
ordering are unchanged — the mode only reinterprets a row's clicks, it does not reshuffle the list.

The list's top button row is **replaced, while selecting, by a select bar**: a live **count of picked
sessions**, an adjacent icon-only **close** action, and a **cancel** that leaves the mode without touching
anything. The icon tooltip names the action. Close is disabled at zero picks and opens one confirm naming how
many sessions it affects. It uses the same per-session endpoint as its single-row counterpart, never a bulk-only
lifecycle path. Archive is a place below the list, not a second bulk lifecycle verb.

Confirming **dismisses the prompt at once** and fires all selected close requests in the
**background** — the same fire-and-forget the single close and the New Session launch use
([[session-console]]), never a frozen dialog watching N worktree operations run — then leaves multi-select
mode and asks the board to reload, so changed rows converge across every surface together. A failed request is
reconciled by the next board poll and its returned reason is shown through the same session action outcome as a
single close; HTTP 409 is never a console-only clue or a silent success. Cancelling, or pressing Esc, leaves
the mode with nothing changed.

The bulk lifecycle confirm focuses its destructive commit button on open, so a plain **Enter** confirms the
visible close action. Escape, Cancel, and a backdrop click still cancel without issuing a request.

The select bar and its confirms are this node's own surface (`SessionSelectBar.jsx`); mode state (picks,
drag source/target, and row toggle-instead-of-switch behaviour) lives in the list that owns the rows
([[session-console]]'s `SessionInterface`), and the menu item that turns the mode on is a one-line hook into
the right-click menu ([[session-rename]]'s `SessionContextMenu`). The drag is merely a presentation route to
the existing reparent endpoint, so its source-aware watcher transaction remains shared with CLI recovery.
