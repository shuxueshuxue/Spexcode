---
title: worktree-resilience
status: active
session: db617645-24cd-4700-a53a-94d901127843
hue: 20
desc: The backend never dies on a worktree that vanishes mid-read — it skips the entry and keeps serving.
code:
  - spec-cli/src/resilience.ts
---
# worktree-resilience

## raw source

The backend reads the set of worktrees live on every board and layout request. A dispatched worker can
finish, merge, and have its own worktree removed at any instant — so a read that just checked a path can
find it gone a moment later. Twice now that race has killed the whole server: the failed read threw,
nothing caught it, and the process exited, dropping the public port and taking the proxied frontend down
with it. A worker tidying up after itself must never be able to crash the thing watching it.

## expanded spec

Two layers, each loud, neither silent.

**Per-read skip.** Every place that walks the worktree set and reads per-worktree files — the layout
overlay and the session list — treats a single worktree as droppable. If reading one entry throws (it
vanished, or its files are momentarily unreadable) that entry is skipped with a one-line log and the rest
of the list is still served. A disappearing worktree costs its own row, never the whole board.

**Last-resort guard.** The server and the supervisor each install a process-level net for anything the
per-read layer didn't foresee. An uncaught exception or unhandled rejection is logged and the process
keeps serving instead of exiting. The supervisor owns the public port, so its survival is what keeps the
port — and therefore the frontend — alive across a transient fault.

The contract is resilience, not blindness: every skip and every caught crash is logged, so a genuine bug
stays visible and investigable. The guard only changes the consequence of an unforeseen throw from "the
backend dies" to "the backend logs it and stays up".
