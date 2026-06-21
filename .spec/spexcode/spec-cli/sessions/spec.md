---
title: sessions
status: active
hue: 280
desc: Durable worktree sessions — the subsystem overview; launch/state/dispatch/graph own the detail.
code:
  - spec-cli/src/board.ts
---

# sessions

## raw source

A SpexCode **session** is a unit of work the dashboard and the CLI launch, drive, and retire through
**one shared module** (the dashboard is a thin caller; `spex` is the CLI). The **worktree** is the
durable thing, not the tmux process — a session survives a kill, a reboot, or a moved folder. The
**agent writes its own state** and may only *propose* merge or close; a **human** makes those calls.
Nothing auto-disappears, so a self-finished session stays findable, and the dashboard and the terminal
are two faces of the **same** state.

## expanded spec

The durable unit is the worktree: each carries an untracked `.session` file (`node` / `session`-id /
`status` / `proposal` / `note` / `merges`) plus a `.session-prompt` sidecar holding the originating
launch prompt. There is no in-memory map — the list is read from the worktrees every time, so state
survives a backend restart. `sessions.ts` holds the machine and is the only writer of `.session`.

The subsystem divides into four governed concerns, each its own child node:

- **[[launch]]** — bringing a worker up: the `reclaude` wrapper, the per-session rendezvous socket, the
  non-truncating system-prompt + launch-prompt delivery, `CLAUDE.md` isolation, and the concurrency
  cap with its durable launch queue.
- **[[state]]** — the lifecycle state machine: the declared statuses, the per-session `Stop` /
  `PreToolUse` / `Notification` hooks that gate them, AskUserQuestion → `needs-input`, and socket-based
  liveness via `reconcile`.
- **[[dispatch]]** — delivering a prompt to a live agent over its rendezvous socket (socket-only,
  fail-loud), and the merge intent that rides that path.
- **[[graph]]** — the live monitor network (edge A→B iff A runs `spex watch B`) and the `spex watch`
  lifecycle event stream.
- **[[live-view]]** — the dashboard's live terminal: one real tmux client per session, viewer
  subscriptions that outlive the client so a pane never freezes, and the warm-bridge prewarm.

### Surfaces

One surface stays with the overview. `buildBoard` (`board.ts`) assembles the dashboard's runtime state —
merged tree + per-worktree overlay + the session list — in one module, served identically at HTTP
`/api/board` and `spex board` (the frontend only adds x/y pixels). `captureSession` remains for
`spex capture`.
