---
title: worktree-resilience
status: active
session: db617645-24cd-4700-a53a-94d901127843
hue: 20
desc: A worktree's existence is definitive, never contingent on a flaky detail read — the board lists every worktree that exists and the backend never dies on one that vanishes.
code:
  - spec-cli/src/resilience.ts
---
# worktree-resilience

## raw source

The backend reads the set of worktrees live on every board and layout request. A dispatched worker can
finish, merge, and have its own worktree removed at any instant — so a read that just checked a path can
find it gone a moment later, and concurrent merges hold git index/ref locks that make a per-worktree `git`
read throw. Two failures came from this. First, the race crashed the whole server: a failed read threw,
nothing caught it, the process exited and dropped the public port. Second — subtler — the guard that fixed
the crash *over-corrected*: it dropped a worktree on **any** read throw, so a momentary unreadable detail
made a **live** worktree vanish from the board, and the watch feed then reported it falsely **closed**. A
read failure is not non-existence. Existence must not be hostage to a flaky detail read.

## expanded spec

Existence and details are **separate facts**, and the guard decides on existence alone.

**Existence is definitive.** A worktree listed by `git worktree list` whose directory is still on disk
**exists**, no matter what reading its details did. So the per-read guard branches on the **directory**,
never on the read outcome: directory gone → the worktree was genuinely removed → **omit** that row;
directory still present but the detail read threw (a session-record ENOENT race, or a `git diff`/`merge-base`
hitting an index/ref lock under a concurrent merge) → a transient **detail** failure → serve a **degraded**
row built from raw facts (path, branch, branch-derived node) plus the last-known value, **never** drop it.
Every place that walks the worktree set — the layout overlay and the session list — passes such a degraded
fallback, so the board **always lists every existing worktree**. A live session therefore never disappears
from the board for a poll, which is what used to surface as a spurious removal.

**Enumeration is fail-loud.** The worktree set is the board's existence truth, so a *failed enumeration*
must never masquerade as an empty repo. `git worktree list` always lists at least the main worktree, so a
git error or a zero-row parse is a failure, not "every worktree vanished": the enumerator **throws** rather
than returning an empty list. The caller surfaces it — a layout request fails loudly, and the watch poll's
own catch simply skips that tick with its prior state intact — instead of fabricating a mass removal from a
momentary outage.

**Last-resort guard.** The server and the supervisor each install a process-level net for anything the
per-read layer didn't foresee. An uncaught exception or unhandled rejection is logged and the process keeps
serving instead of exiting. The supervisor owns the public port, so its survival is what keeps the port —
and the proxied frontend — alive across a transient fault.

The contract is resilience, not blindness: every omit, every degraded row, and every caught crash is
logged, so a genuine bug stays visible. The guard only changes the consequence of a transient fault from
"the backend dies" or "a live worktree is dropped" to "it is logged and the board stays whole".
