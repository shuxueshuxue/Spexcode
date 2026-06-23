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

The list is ordered by **session birth, oldest first** — derived from the **worktree directory's**
birthtime. The directory is created once by `git worktree add` and lives for the session's whole life, so
its birthtime is the one stable creation anchor; the `.session` file's own birthtime is unusable because
writers recreate that file, resetting it to the last major write. Git enumerates worktrees alphabetically
by path, and a path is a slug of the launch prompt, so the raw order is arbitrary *and* reshuffles whenever
a session joins or leaves; birth order instead gives every session a permanent slot with new ones appending
at the end — one stable spatial map shared by the dashboard window, the session tabs, and `spex ls`.

The subsystem divides into governed concerns, each its own child node:

- **[[launch]]** — bringing a worker up: the `reclaude` wrapper, the per-session rendezvous socket, the
  non-truncating system-prompt + launch-prompt delivery, `CLAUDE.md` isolation, and the concurrency
  cap with its durable launch queue.
- **[[state]]** — the lifecycle state machine: the declared statuses, the per-session `Stop` /
  `PreToolUse` / `Notification` hooks that gate them, AskUserQuestion → `asking`, and socket-based
  liveness via `reconcile`.
- **[[dispatch]]** — delivering a prompt to a live agent over its rendezvous socket (socket-only,
  fail-loud), and the merge intent that rides that path.
- **[[graph]]** — the live monitor network (edge A→B iff A runs `spex watch B`) and the `spex watch`
  lifecycle event stream.
- **[[live-view]]** — the dashboard's live terminal: one real tmux client per session, viewer
  subscriptions that outlive the client so a pane never freezes, and the warm-bridge prewarm.
- **[[remote-client]]** — the `spex` CLI as a thin backend client: its read/control verbs route through the
  backend (so the backend is the single tmux actor, and `SPEXCODE_API_URL` points at any machine's sessions),
  while state producers stay local.

### Surfaces

One surface stays with the overview. `buildBoard` (`board.ts`) assembles the dashboard's runtime state —
merged tree + per-worktree overlay + the session list, plus the backend's own project identity (the
browser-tab name) — in one module, served identically at HTTP `/api/board` and `spex board` (the frontend
only adds x/y pixels). An added (ghost) node nests into the tree by directory ancestry — including
ancestry among the *other* nodes the same worktree adds — so a worktree introducing a whole new subtree
at once (e.g. an `extract` scaffold of a fresh root) renders as one tree under its single new root, not a
flat scatter of one root per node. The session's live pane is read as text by
`captureSessionResult` behind `GET …/capture` — failure (unknown / offline / capture-error) kept distinct
from an empty pane — which `spex capture` reads as a backend client (see [[remote-client]]).

`buildBoard` is also the shared hub where sibling features fold their own per-node sidecars onto these
nodes ([[dashboard-issues]] issues, [[yatsu-eval-tab]] evals); this overview owns the tree / overlay /
session-list / identity assembly, so such a fold is that feature's stake, not `sessions`' drift.
