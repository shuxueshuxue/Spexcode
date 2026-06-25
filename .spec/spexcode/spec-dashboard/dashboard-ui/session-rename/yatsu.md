---
scenarios:
  - name: rename-overrides-and-clears
    description: >
      Through the running dashboard in a real browser, open the session console (Enter), right-click a
      session row, and pick "rename" — a centred prompt opens prefilled with the current override (blank if
      none). Type a new display name and submit. Watch the row's label across the console list (and the
      top-left window glance, same precedence). Then right-click the same row, rename again, clear the field
      to blank, and submit. Screenshot the row label before, after the rename, and after the blank-clear.
    expected: |
      Submitting a name immediately relabels the session everywhere it is named — the console tab/list and
      the top-left window both read the new name (it wins at the top of the `name ▸ node ▸ title ▸ branch ▸
      id` precedence), because every surface reads that one shared precedence after the board reload. A blank
      name is a RESET, not an error: it clears the override and the row falls back to its derived label
      (node/title/branch/id). The rename never edits the live terminal — a session in any state is renamable.
  - name: close-confirm-removes-row
    description: >
      Through the running dashboard in a real browser, open the console (Enter), right-click a session row,
      and pick "close". A confirm prompt (the shared modal, its commit button styled as the destructive
      verb) must appear FIRST — close is not a one-click action on the menu. Press cancel and confirm the row
      is untouched; then right-click → close → confirm and watch the row. Screenshot the confirm prompt and
      the list after confirming.
    expected: |
      Picking "close" opens a confirm prompt rather than closing immediately (a right-click is easy to
      mis-aim and the worktree removal is destructive). Cancelling does nothing — the row stays. Confirming
      POSTs the human-only worktree removal and asks the board to reload, so the closed row drops off every
      surface at once. This is the same removal the (now-absent) header close once did, behind a guard.
---

# session-rename — yatsu

Measure through the **real session-row right-click menu**, YATU-style: open the console with `Enter`,
right-click an actual row, and drive the real rename prompt / close confirm — never a direct
`POST /api/sessions/:id/rename` or `/close`, and never an internal label helper. The loss is the two
contracts this node owns: a **rename** is a persisted display override that wins at the top of the shared
label precedence on every surface and that a **blank** value clears back to the derived label; and **close**
is the one human-only worktree removal, reachable only here and only **behind a confirm**. The tab-fallback
landing after a close (where the view goes) is [[session-console]]'s scenario, not this one.
