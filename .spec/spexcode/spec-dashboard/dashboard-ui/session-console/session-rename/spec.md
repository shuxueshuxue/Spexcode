---
title: session-rename
status: active
hue: 300
desc: The selected session's document tools menu gives it a human name — a persisted override that wins over the derived label.
code:
  - spec-dashboard/src/SessionContextMenu.jsx#SessionContextMenu
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/styles.css
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-dashboard/test/session-close-freshness.e2e.mjs
---

# session-rename

## raw source

Sessions are labelled automatically — by the spec node they touch, or a few words of their launch
prompt, or their branch. That default is fine until a human needs to fix it: two sessions on the same
node read alike, and a node-agnostic session wears an awkward prompt fragment forever. The selected session's
document tools menu opens the small action menu: **spec related** opens the nodes this session is changing,
**rename** gives it a human name that sticks, and **close** offers worktree removal one click away —
the destructive twin of the typed `/close` command ([[session-console]]), distinct from `/stop`, which only
stops the agent and keeps the worktree.

## expanded spec

A rename sets a session's **name** — a user-chosen display override kept distinct from the auto-derived
title, so naming a session never fights or erases the launch-time derivation. The name sits at the
**top** of the label precedence on every surface (`name` ▸ node ▸ title ▸ branch ▸ id): once set it wins
over the node a session references, so the human's label is authoritative wherever the session is
named — the top-left window, the [[session-console]] tabs, and the CLI's `spex` listings — because they
all read that one shared precedence.

The name lives where the rest of a session's record lives: the session's record in the per-user global
store ([[state]]/[[runtime]]), written by the one backend that owns it. So a rename **persists** — it survives a backend restart and is read
back like any other field, never held only in the browser. A session in **any** state is renamable
(queued, live, or offline), because the gesture edits the on-disk record, not the live terminal.
The CLI reaches that same write with `spex session rename <SEL> "<name>"`; inside a launched worker `.` is the
shared selector for its own session ([[session-selectors]]), so a prompt preset such as [[rename]] can ask the
agent to name itself without learning an id or creating a dashboard-only action.

**Spec related is a door, not a verb.** A session is only legible next to the intent it is changing, so the
menu's first spec entry carries no action of its own: it opens a panel beside it ([[context-menu-chrome]])
listing the nodes this session's pending ops touch, read through the shared session-to-nodes join so this
door and the graph overlay can never name different nodes. Each row opens that node as a document at the
same `#/spec/<id>` address an inline `[[id]]` resolves to, so the menu's door and a reference's door are one
door. **A row says WHICH change it is**: its leading mark is the board's own overlay glyph for that op —
the same mark the graph tile, the legend and the node popup's edit pane spend — so added, edited, deleted
and moved read the same here as everywhere else, and the door never repeats one decorative icon down a list
of different news. That mark is decoration: it is hidden from assistive technology, which hears the node
named with its op spelled out beside it. The list is CAPPED — a wide session must not push the menu's own
verbs off the screen — and what the cap hides is said rather than dropped. The panel's last row is fixed: **find on graph**, the board-wide
answer that spotlights every one of those nodes at once and lets the eye walk them; it is the same lock the
graph has always had, named for what it does rather than for its mechanism.

**One menu, two ways in.** The selected session's **document tools** button in [[session-console]] opens it
for the session you are reading; a **right-click on a finding-dock session row** ([[dock-modes]]) opens it for
any row. The dock row itself stays read-only navigation — the row navigates, the menu acts — and that is what
keeps a finding projection free of mutation state while still being where a human points at a session. Losing
the second door is not a simplification: when the console's own list was withdrawn and the menu did not travel
with the rows, rename and attach had no pointer route left anywhere in the window.

The menu may also expose the Sessions document's explicit selection entry and, for a nested row, the existing
detach/reparent command. Those entries hand off to the Sessions forest owner; they do not change this menu's
rename/close lifecycle contract or create a second close endpoint.

**The opener may be a press of either button, so dismissal must survive both.** An outside press closes the
menu — the PRESS, not the click, and only when its target is outside the menu and outside a control that
declares it owns a menu. Closing on any click at all works exactly as long as every opener is a right-click,
because a contextmenu press emits no click; the moment a plain button opened this menu the opening click
reached the dismissal and shut it in the same gesture, so the button visibly toggled and no menu ever
appeared. Testing the target is also what lets an opener toggle: pressing it again closes rather than closing
and immediately reopening.

The tools button opens a cursor-anchored pop-over (its own surface). Picking
**rename** swaps the menu for a centred prompt (the shared modal chrome) that **titles itself with the
session's headline** — the same words its row shows ([[session-activity]]), not the stable rename handle,
so the human reads the very label they right-clicked and never renames what looks like a different
session — and is prefilled with the current override and ready to type over. Submitting hands the new name to the backend;
its successful sessions-domain nudge advances the shared board through graph-stream, so the new label appears on
every surface at once rather than only where it was triggered or behind an action-local graph refetch. A failed
write may recover through the ordinary board reload path. A
**blank** name is a **reset**, not an error: it clears the override and the session falls back to its
derived label. Renaming an unknown session fails loudly — the endpoint answers 404 — never a silent
success.

Archive is reached from the sessions dock's bottom `View all` door and remains a document overlay; it is not
part of this tools menu. The current dock has no batch-selection mode; any future batch operation needs its own
current contract and belongs to an explicit selection mode in that list. Moving a session by drag is not this
node's: it lives with the list that shows the sessions ([[dock-modes]]),
because where a session sits is the shape of that list rather than an action on one session.

The menu's second item, **close**, runs the same human-only worktree removal as the typed `/close` command,
but behind a **confirm prompt** — a right-click is easy to mis-aim and the removal is destructive, so unlike
the typed command (whose deliberate keystrokes ARE the confirmation) it asks first (the confirm is the shared
modal, its commit button styled as the destructive verb). Like the rename prompt, the confirm **titles itself
with the session's headline** — the same label its card shows ([[session-activity]]), not the stable rename
handle — so the human reads the very words they right-clicked and never has to map a different name onto the row. Confirming
**dismisses the prompt at once** and fires the close in the **background**: worktree + branch removal is
seconds of real work (a `git worktree remove` plus killing the agent + tmux), and the human must never sit
watching a frozen, disabled dialog wait it out — the same fire-and-forget the New Session launch already uses
([[session-console]]). A successful close invalidates the session graph before its 200 response and pushes
the changed session units to connected boards, so the row leaves every surface when the removal lands even
if the best-effort store/worktree watchers are unavailable; the patrol is recovery, never the normal close
acknowledgement. Cancelling does nothing. The menu carries only the
decisive **close**, never the soft `/stop` — stopping-to-resume is a Command Box verb on a live session.

Both lifecycle confirms open with their destructive commit button focused, so a plain **Enter** confirms the
visible archive or close action. Escape, Cancel, and a backdrop click remain cancellation paths; Enter does
not weaken the preceding right-click confirmation boundary.

**The close confirm has TWO openers and one body.** The menu's own item is the first; a session row dropped
on the dock's archive door is the second ([[dock-modes]]). The removal is byte-for-byte the same removal, so
it is one prompt reached two ways rather than two prompts for one destruction — two dialogs would be two
places for the wording, the destructive styling and the fire-and-forget semantics to drift apart. The second
opener is owned by its caller rather than by this menu, so dismissing hands the request back instead of only
clearing state here; that is what keeps a cancelled drop from leaving a dead request behind it. A drag is a
more deliberate gesture than a right-click, which is a reason to trust the AIM, never a reason to skip the
confirmation — what is being confirmed is the removal, not the accuracy of the pointer.

A close refusal is a visible action failure, not a silent background no-op: the backend returns a non-2xx
structured error when its ownership guard commits no removal, and the console keeps the selected row while
showing that diagnostic **once** through its shared action-error surface. A refusal never weakens the guard merely to
make the row disappear.

An unreadable record exposes one additional, deliberately narrow **quarantine** item in this same menu, and
no healthy row does. Its modal takes the exact adapter/thread/tmux/worktree/branch witness the human recovered
from the opaque incident and posts it to the shared record-integrity control. It supplies no guessed lifecycle
or cleanup default: the backend independently proves every claimed residue absent (or archives only its exact
unowned native thread) before moving the bytes. Success closes the modal and reloads the board so the active
corrupt row disappears; refusal keeps the row and routes its precise reason through the existing single action
error surface. The public Restore control returns opaque bytes to the active projection without launching a
runtime; because a quarantined row no longer belongs to this active list, that recovery is intentionally the
CLI/API control rather than a phantom menu item on a missing row.

The right-click confirm consumes both the HTTP status and the JSON `{ok,error}` body before it asks the board
to reload, so a legacy 200 false response cannot regress into a silent success while the endpoint is being
rolled forward.

Because both the pop-over and its prompt are opened **from** the board, each must render **above** it:
a menu or modal that paints behind its own surface is present in the DOM yet invisible and unclickable,
so they live on the top layer — over the board's backdrop, never beneath it. A surface cancels the OS
context menu only where it offers this menu in its place — the dock's session rows — and nowhere else:
cancelling it across a whole panel of conversation text, diff text and terminal takes copy, paste and
search-selection from a reader in exchange for nothing ([[session-console]]). The tools button remains an
ordinary focused document control, so opening the menu never steals focus from the current TUI or Command Box.

The pop-over is the one home for selected-session document actions. Its **lock on graph** item invokes the console's
existing lock action and routes to `#/graph`; [[session-console]] owns that lock's no-pending-ops semantics.
The same menu also hosts [[attach-menu]]'s live-only attach item. It offers no list-selection or batch-lifecycle
action. Row drag/reparent is a dock-list gesture, not a selected-session menu action, and its owner is [[dock-modes]].

Its surface mounts the shared [[context-menu-chrome]]: compact icon-led text rows, grouped commands, and a
separate destructive close row. This node supplies the session actions; it never forks the menu chrome.

This node's slices of the shared files are the rename/confirm-modal styling in `styles.css` and the
rename route in `index.ts`; the eval tab's `.eval-*` styles and its eval-blob endpoint, reworked in
the measure-and-score reframe, are [[spec-eval]]'s churn, not session-rename's drift.

## the row context menu

A **right-click on a session row** opens its context menu — **lock on graph**, rename, archive or close
([[session-rename]] / [[archive]]), and **attach** for a live row ([[attach-menu]], which hands over the
`spex session attach <id>` command to join the session's real tmux) — coexisting with the context-menu
suppression. Archive and close share the menu's danger group and each confirms before its lifecycle request.
Lock on graph locks the board to that session and navigates to
`#/graph`; it has no pending-ops precondition, so an ops-less session still lands on the graph with the lock
banner explaining the empty grip. The shared `sessionName` puts a rename first in the label precedence.
Context menus and anchored dropdowns use their border with shallow ambient depth only; they do not cast a bright
halo around the menu edge.
