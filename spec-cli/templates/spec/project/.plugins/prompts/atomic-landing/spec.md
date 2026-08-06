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
3. A clean textual merge is not product proof; the synced branch's verification is required.

`spex guide spec` has the shared-checkout mid-merge rule.
