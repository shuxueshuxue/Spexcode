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
  non-truncating system-prompt + launch-prompt delivery, `CLAUDE.md` isolation, and the concurrency cap
  with its durable launch queue.
- **[[state]]** — the lifecycle state machine: the declared statuses, the per-session `Stop` / `PreToolUse`
  / `Notification` hooks that gate them, AskUserQuestion → `asking`, and socket-based liveness via
  `reconcile`. Agent-authored, never inferred.
- **[[runtime]]** — the per-worktree `.session/` directory: every harness-written artifact (state record,
  prompts, generated hooks, launch script, isolated `CLAUDE.md`) under one ignored, mergeable-clean folder,
  with a bounded compat shim for legacy flat dotfiles.

The shared guarantee: state is read from the worktrees every time (no in-memory map), so a session's life
is reconstructed from disk after any backend restart — the worktree, its `.session/state`, and its socket
liveness are the whole truth.
