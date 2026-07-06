---
title: sessions
status: active
hue: 280
desc: Durable worktree sessions — the subsystem overview; lifecycle/comms/injected-context own the detail.
code:
  - spec-cli/src/board.ts
---

# sessions

## raw source

A SpexCode **session** is a unit of work the dashboard and the CLI launch, drive, and retire through
**one shared module** (the dashboard is a thin caller; `spex` is the CLI). The **worktree** is the durable
thing, not the tmux process — a session survives a kill, a reboot, or a moved folder. The **agent writes
its own state** and may only *propose* merge or close; a **human** makes those calls. Nothing
auto-disappears, so a self-finished session stays findable, and the dashboard and the terminal are two
faces of the **same** state.

## expanded spec

State lives on disk, not in memory, but NOT in the worktree: each session has a record in a per-user GLOBAL
store keyed by its harness `session_id` ([[state]]/[[runtime]]), so the session list is **enumerated from
that store** every time — filtered to the `governed` (dashboard-launched) records — and survives a backend
restart, while the worktree itself stays pristine ([[lifecycle]] owns the store, the state machine, and the
worktree↔record mapping). The list is ordered by **session birth, oldest first** — by the record's stored
`createdAt`, the one creation anchor that outlives every state rewrite — so each session keeps a permanent
slot, new ones appending at the end: one spatial map shared by the dashboard window, the session tabs, and
`spex ls`. A self-launched (non-governed) agent gets spec-awareness but no board row.

The subsystem divides into governed concerns:

- **[[lifecycle]]** — a session's existence: [[launch]] (bring a worker up), [[state]] (the agent-authored
  status machine + liveness), [[runtime]] (the per-session global store under `~/.spexcode`).
- **[[comms]]** — the inter-agent mesh over one rendezvous socket: [[dispatch]] (deliver a prompt; merge as
  a dispatched prompt), [[agent-reply-channel]] (reply hint), [[comms-edge]] (recorded talk + graph edge),
  [[graph]] (the live watch network).
- **[[injected-context]]** — what a launched session is fed to start spec-aware: [[spec-pointer]] (the live
  spec path, never the body) and [[spec-first]] (the read-before-write nudge).
- **[[session-selectors]]** — one selector grammar (id · prefix · node · branch) so every command names the
  same sessions.
- **[[live-view]]** — the dashboard's live terminal: one tmux client per session, viewer subscriptions that
  outlive it, and the warm-bridge prewarm.
- **[[remote-client]]** — the `spex` CLI as a thin backend client, so one install monitors any machine's
  sessions and the backend stays the single tmux actor.
- **[[session-attach]]** — the human escape hatch: foreground `tmux attach` into a worker's real session,
  the one deliberately LOCAL verb (a terminal can't be brokered over HTTP).

### Surface

One surface stays with the overview. `buildBoard` (`board.ts`) assembles the dashboard's runtime state — the
merged spec tree, the per-worktree overlay (a ghost/added node nests by directory ancestry, so a worktree
introducing a whole new subtree renders as one tree, not a flat scatter), the session list, and the
backend's own project identity (the browser-tab name) — in one module, served identically at HTTP
`/api/board` and `spex board` (the frontend only adds x/y pixels). It is also the shared hub where sibling
features fold their per-node sidecars onto these nodes ([[dashboard-issues]] issues, [[yatsu-eval-tab]]
evals) and behind which the live pane is read as text at `…/capture` (which [[remote-client]]'s `spex
capture` reads) — so such a fold is that feature's stake, not `sessions`' drift.
