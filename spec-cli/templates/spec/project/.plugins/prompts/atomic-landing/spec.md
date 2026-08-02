---
title: atomic-landing
surface: system
status: active
hue: 30
desc: A config plugin — the trunk checkout is the fleet's one landing door, so a merge must be trivial by the time it reaches it: sync and resolve in YOUR OWN worktree, land only when your branch already contains the trunk, and wait rather than race for a busy door.
code:
---
## Landing is atomic

1. In your worktree, merge `<base>` into the branch, resolve conflicts there, and rerun the proof.
2. Immediately before landing, require `git merge-base --is-ancestor <base> <branch>`; otherwise sync again.
3. If the shared checkout is mid-merge, wait. Never abort or resolve someone else's merge; if your own landing
   stops half-merged, abort it and report.
4. A clean textual merge is not product proof; the synced branch's verification is required.
