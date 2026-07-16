---
scenarios:
  - name: attach-shows-command
    tags: [frontend-e2e, desktop]
    description: >
      On the session console (#/sessions), right-click a LIVE session row and pick "attach…" from the context
      menu. A modal titled with the session's headline should open showing a single read-only command field.
      Read the command text from the live DOM and compare it to `spex session attach <id>`, where <id> is that
      row's session id. Confirm the field is selectable (click selects all) and the copy button is present.
    expected: >
      The modal shows exactly `spex session attach <id>` with the right-clicked session's id — the project's
      own blessed attach verb, not a hardcoded `tmux -L … attach` string. The field is read-only and click-to-
      select, a copy button sits beside it, and the modal mutates no session (it only hands over the command).
      The command, pasted into a shell on the host, foreground-attaches a real tmux client to that session.
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
right-click an actual row, pick attach, and read the popped modal's command straight from the live DOM —
never by reasoning about the source. The loss is the two contracts this node owns: the command is
`spex session attach <id>` for the right-clicked row (the blessed CLI verb, [[session-attach]], not a raw
tmux string), and attach is offered only when a live tmux window exists (present on live rows, absent on
offline/queued). The command's real attachability is the CLI verb's contract ([[session-attach]]), verified
once on the host, not re-proven per reading.
