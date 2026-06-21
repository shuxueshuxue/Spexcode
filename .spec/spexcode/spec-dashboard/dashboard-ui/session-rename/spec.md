---
title: session-rename
status: active
hue: 300
desc: Right-click a session row on the session board to give it a human name — a persisted override that wins over the derived label.
code:
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
---

# session-rename

## raw source

Sessions are labelled automatically — by the spec node they touch, or a few words of their launch
prompt, or their branch. That default is fine until a human needs to fix it: two sessions on the same
node read alike, and a node-agnostic session wears an awkward prompt fragment forever. Right-clicking a
session row should open a small menu whose one verb, **rename**, lets a human give that session a name
that sticks.

## expanded spec

A rename sets a session's **name** — a user-chosen display override kept distinct from the auto-derived
title, so naming a session never fights or erases the launch-time derivation. The name sits at the
**top** of the label precedence on every surface (`name` ▸ node ▸ title ▸ branch ▸ id): once set it wins
over the node a session references, so the human's label is authoritative wherever the session is
named — the top-right window, the [[session-graph]], the [[session-console]] tabs, and the CLI's `spex`
listings — because they all read that one shared precedence.

The name lives where the rest of a session's record lives: the worktree's `.session` file, written by
the one backend that owns that file. So a rename **persists** — it survives a backend restart and is read
back like any other field, never held only in the browser. A session in **any** state is renamable
(queued, live, or offline), because the gesture edits the on-disk record, not the live terminal.

The gesture is a **right-click** on a session row **in the session board's left-hand session list**
([[session-console]]) — the interactive surface where a human manages sessions, not the read-only
top-right glance ([[session-graph]]), which deliberately carries NO menu: a mutation belongs on the
board, never on the at-a-glance summary. It opens a cursor-anchored pop-over (its own surface). Picking
**rename** swaps the menu for a centred prompt (the shared modal chrome) prefilled with the current
override and ready to type over. Submitting hands the new name to the backend and asks the board to
reload, so the new label appears on every surface at once rather than only where it was triggered. A
**blank** name is a **reset**, not an error: it clears the override and the session falls back to its
derived label. Renaming an unknown session fails loudly — the endpoint answers 404 — never a silent
success.
