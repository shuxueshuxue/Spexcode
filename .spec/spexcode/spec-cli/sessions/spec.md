---
title: sessions
status: active
hue: 280
desc: Durable worktree sessions (the state machine) + the shared board assembler.
code:
  - spec-cli/src/sessions.ts
  - spec-cli/src/board.ts
---

# sessions

A SpexCode session is a unit of work the dashboard (and an agent's CLI) can launch, drive, and
retire. The durable unit is the **worktree**, not the tmux process: each session worktree carries an
untracked `.session` file (`node` / `session`-id / `status` / `merges`) that is the source of truth and
survives a kill, reboot, or moving the folder. There is no in-memory session map — the list is read
from the worktrees every time, so state survives a backend restart.

The state machine has two real states plus derived liveness. `active` reconciles against tmux into
**working** (pane changed recently), **idle** (alive, quiet), or **offline** (no tmux for the recorded
id — relaunch to resume). `awaiting` carries the agent's proposal — **review** (merge me), **done**
(finished, your call), or **close-pending** (discard me?) — and the agent only ever *proposes*: merge
and close are human-only, every proposal is reversible with back-to-working, and nothing is ever
auto-removed, so a self-completed session is always findable. `merged` is metadata (a count), not a
state — after a merge the worktree returns to active.

Sessions launch with `claude --session-id <uuid>` on a private `tmux -L` socket with
`--dangerously-skip-permissions`, so the same conversation can be `--resume`d after the process dies,
and the chosen id equals the worktree's `.session` id and the commit attribution — linking a spec node
to its live session for free. `buildBoard` assembles the dashboard's runtime state — the merged tree,
the per-worktree overlay (ghosts for adds, edit/delete/move marks, drift), and the session list — in
one shared module so the HTTP `/api/board` and `spex board` return identical data; the frontend only
adds x/y pixels.

`buildBoard` is also the **only** place a node's status can become `active`: it re-derives each node's
four-state status (see [[spec-node-states]]) *with* the overlay it just computed, so a node an unmerged
worktree is touching reads `active` and a not-yet-on-main ghost reads `active` rather than `pending`.
The overlay's op-types (`added`/`edited`/`deleted`/`moved`) and the session list's reconciled states
(`working`/`idle`/`offline` and the `awaiting` proposals) are carried through unchanged to the UI.
