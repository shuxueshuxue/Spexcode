---
title: atomic-landing
surface: system
status: active
hue: 30
desc: A config plugin — the trunk checkout is the fleet's one landing door, so a merge must be trivial by the time it reaches it: sync and resolve in YOUR OWN worktree, land only when your branch already contains the trunk, and wait rather than race for a busy door.
code:
---
## Landing is atomic — conflicts belong in YOUR worktree, never in the shared checkout

Every worktree lands through ONE shared directory: the trunk checkout. Git refuses any merge while that
directory's index holds an unresolved one, so a merge that stops to ask about conflicts holds the fleet's
only landing door for as long as a human takes to think — while a merge that *cannot* conflict holds it for
milliseconds. Land only the second kind.

- **Sync first, in your own worktree.** Before you land, merge the trunk INTO your branch (`git merge
  <base>`) right where you work: resolve every conflict there and re-run what proves your work — the tests,
  the scenario you measured. Your worktree is the only place that has your context, your tooling, and nobody
  waiting behind you.
- **The landing itself must be trivial.** `git merge-base --is-ancestor <base> <branch>` must be TRUE at the
  moment you land: your branch already contains the trunk, so the merge writes a commit and nothing else. If
  it is false — the trunk moved while you were testing — do NOT land: sync again, then land. Resolving
  conflicts *in the shared checkout* is the one forbidden move; it blocks everyone behind a half-merged index,
  and it decides the conflict in the place with the least context about the other side.
- **A busy door is a wait, not a race.** If the shared checkout is already mid-merge, you cannot land — wait
  and retry, bounded. Never `git merge --abort` someone else's in-progress merge and never resolve their
  conflicts for them: that is their work in flight, and aborting it destroys the part they had already
  reasoned through. If your OWN landing ends up half-merged, abort yours and report rather than leaving the
  trunk mid-state.
- **An auto-merge is not a tested merge.** A clean merge proves the texts didn't overlap, not that the
  combination works: two branches can each be green and their merge red. That is why the sync happens where
  you can re-run the proof, and why "it merged without conflicts" is never the standard for landing.
