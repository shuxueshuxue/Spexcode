---
scenarios:
  - name: attach-shows-both-commands
    tags: [frontend-e2e, desktop]
    description: >
      On the session console (#/sessions), right-click a LIVE session row and pick "attach…" from the context
      menu. A modal titled with the session's headline should open showing TWO read-only command fields. Read
      both from the live DOM: one must equal `spex session attach <id>` and the other `tmux -L <socket> attach
      -t <id>`, where <id> is that row's session id and <socket> is the backend's tmuxSocket from /api/settings
      (default `spexcode`). Confirm each field is selectable (click selects all) and has its own copy button.
    expected: >
      The modal shows both attach forms for the right-clicked row: the blessed `spex session attach <id>` and
      the raw `tmux -L <socket> attach -t <id>` with the real socket (never hardcoded — sourced from the
      backend). Each sits in its own read-only, click-to-select field with its own copy button, and the modal
      mutates no session (it only hands over the commands). Either command, pasted into a shell on the host,
      attaches a real tmux client to that session.
  - name: attach-only-when-live
    tags: [frontend-e2e, desktop]
    description: >
      Right-click a LIVE row (liveness online) and confirm "attach…" is in the menu; then right-click an
      OFFLINE row (a stopped/dormant session) and confirm "attach…" is ABSENT. A queued row (not yet launched)
      likewise shows no attach item.
    expected: >
      Attach appears only when a live tmux window exists to join: present on a non-offline, non-queued row,
      absent on offline and queued rows (matching the CLI verb's own offline-loud stance). Rename, select, and
      close remain on every row regardless.
---

# attach-menu — yatsu

Measure through the **real session-row right-click menu**, YATU-style: run the dashboard (`npm run dev` in
spec-dashboard) against a `spex serve` with at least one live session, open the console with `Enter`,
right-click an actual row, pick attach, and read the popped modal's commands straight from the live DOM —
never by reasoning about the source. The loss is the two contracts this node owns: the modal offers BOTH
`spex session attach <id>` (the blessed CLI verb, [[session-attach]]) and `tmux -L <socket> attach -t <id>`
(socket from the backend, id of the right-clicked row), and attach is offered only when a live tmux window
exists (present on live rows, absent on offline/queued). Each command's real attachability is verified once
on the host, not re-proven per reading.
