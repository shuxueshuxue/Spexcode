---
title: session-rename
status: active
hue: 300
desc: Right-click a session row on the session board to give it a human name — a persisted override that wins over the derived label.
code:
  - spec-dashboard/src/SessionContextMenu.jsx
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
---

# session-rename

## raw source

Sessions are labelled automatically — by the spec node they touch, or a few words of their launch
prompt, or their branch. That default is fine until a human needs to fix it: two sessions on the same
node read alike, and a node-agnostic session wears an awkward prompt fragment forever. Right-clicking a
session row should open a small menu: **rename** lets a human give that session a name that sticks, and
**close** offers the worktree removal one right-click away — the destructive twin of the typed `/close`
command ([[session-console]]), distinct from `/exit`, which only stops the agent and keeps the worktree.

## expanded spec

A rename sets a session's **name** — a user-chosen display override kept distinct from the auto-derived
title, so naming a session never fights or erases the launch-time derivation. The name sits at the
**top** of the label precedence on every surface (`name` ▸ node ▸ title ▸ branch ▸ id): once set it wins
over the node a session references, so the human's label is authoritative wherever the session is
named — the top-left window, the [[session-graph]], the [[session-console]] tabs, and the CLI's `spex`
listings — because they all read that one shared precedence.

The name lives where the rest of a session's record lives: the session's record in the per-user global
store ([[state]]/[[runtime]]), written by the one backend that owns it. So a rename **persists** — it survives a backend restart and is read
back like any other field, never held only in the browser. A session in **any** state is renamable
(queued, live, or offline), because the gesture edits the on-disk record, not the live terminal.

The gesture is a **right-click** on a session row **in the session board's left-hand session list**
([[session-console]]) — the interactive surface where a human manages sessions, not the read-only
top-right glance ([[session-graph]]), which deliberately carries NO menu: a mutation belongs on the
board, never on the at-a-glance summary. It opens a cursor-anchored pop-over (its own surface). Picking
**rename** swaps the menu for a centred prompt (the shared modal chrome) that **titles itself with the
session's headline** — the same words its row shows ([[session-activity]]), not the stable rename handle,
so the human reads the very label they right-clicked and never renames what looks like a different
session — and is prefilled with the current override and ready to type over. Submitting hands the new name to the backend and asks the board to
reload, so the new label appears on every surface at once rather than only where it was triggered. A
**blank** name is a **reset**, not an error: it clears the override and the session falls back to its
derived label. Renaming an unknown session fails loudly — the endpoint answers 404 — never a silent
success.

The menu also carries a **reset order** item — shown only when the row has been dragged out of birth order —
which belongs to [[session-reorder]] (it clears that row's manual sort-key), not to this node's rename/close
contract; it rides in this pop-over because the same right-click is where a human reaches for it.

The menu's second item, **close**, runs the same human-only worktree removal as the typed `/close` command,
but behind a **confirm prompt** — a right-click is easy to mis-aim and the removal is destructive, so unlike
the typed command (whose deliberate keystrokes ARE the confirmation) it asks first (the confirm is the shared
modal, its commit button styled as the destructive verb). Like the rename prompt, the confirm **titles itself
with the session's headline** — the same label its card shows ([[session-activity]]), not the stable rename
handle — so the human reads the very words they right-clicked and never has to map a different name onto the row. Confirming
**dismisses the prompt at once** and fires the close in the **background**: worktree + branch removal is
seconds of real work (a `git worktree remove` plus killing the agent + tmux), and the human must never sit
watching a frozen, disabled dialog wait it out — the same fire-and-forget the New Session launch already uses
([[session-console]]). The board reload when the removal lands drops the closed row off every surface;
cancelling does nothing. The menu carries only the
decisive **close**, never the soft `/exit` stop — stopping-to-resume is a typed command on a live session.

Because both the pop-over and its prompt are opened **from** the board, each must render **above** it:
a menu or modal that paints behind its own surface is present in the DOM yet invisible and unclickable,
so they live on the top layer — over the board's backdrop, never beneath it. The board also suppresses
the OS context menu everywhere inside it (the terminal-app feel of [[session-console]]) via a native
capture-phase `contextmenu` listener, and that suppression and this gesture **coexist**: the same
right-click that kills the browser's menu on a row ALSO opens the rename pop-over (the row's own handler
still fires), so blocking the OS menu never costs the human theirs. Right-clicking the
list's empty space below the rows is simply that block with no pop-over — the OS menu is still suppressed
and the docked input keeps focus, never a stolen-focus gap.

This node's slices of the shared files are the context-menu/rename-modal styling in `styles.css` and the
rename route in `index.ts`; the yatsu eval tab's `.eval-*` styles and its eval-blob endpoint, reworked in
the measure-and-score reframe, are [[spec-yatsu]]'s churn, not session-rename's drift.
