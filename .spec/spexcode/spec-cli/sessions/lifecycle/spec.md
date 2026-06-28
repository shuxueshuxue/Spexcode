---
title: lifecycle
status: active
hue: 280
desc: A session's existence — bringing a worker up, the status it reports, and where its runtime scratch lives — all anchored to the durable worktree.
---

# lifecycle

## raw source

The durable thing is the **worktree**, not the tmux process: a session survives a kill, a reboot, or a
moved folder. So a session's *life* is three concerns over that one anchor — how it comes **up**, what
**state** it declares while running, and where its private **runtime** bookkeeping is kept so the worktree
root stays clean and the scratch dies with it. The agent authors its own state; nothing about its life is
inferred behind its back.

## expanded spec

The three concerns each own their detail:

- **[[launch]]** — bringing a worker up: the `reclaude` wrapper, the per-session rendezvous socket, the
  non-truncating launch-prompt delivery, the materialized-contract auto-discovery (no `--append-system-prompt`,
  no hidden `CLAUDE.md`), and the concurrency cap with its durable launch queue.
- **[[state]]** — the lifecycle state machine: the declared statuses, the per-session `Stop` / `PreToolUse`
  / `Notification` hooks that gate them, AskUserQuestion → `asking`, and socket-based liveness via
  `reconcile`. Agent-authored, never inferred.
- **[[runtime]]** — the per-session GLOBAL store under `~/.spexcode` (keyed by `session_id`, grouped per
  project), NOT the worktree: every harness-written artifact (state record, originating + queued prompts,
  launch script, recorded comms, spec sentinels) lives there, so the worktree holds zero per-session
  SpexCode files and stays mergeable-clean.

The shared guarantee: state is read from the global store every time (no in-memory map), so a session's life
is reconstructed from disk after any backend restart — the durable worktree, its global state record, and its
socket liveness are the whole truth.
