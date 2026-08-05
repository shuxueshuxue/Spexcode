---
concern: session close guards the work only on the path where work is impossible by construction
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: sessions-core, cli-surface
created: 2026-08-05T22:41:19.491Z
---

Spec: sessions-core

The destructive close path checks a great deal about the runtime and nothing about the work, while its sibling
path — the one where work cannot exist by construction — checks the work twice. Same inverted-coverage shape as
the [[cli-surface]] `spec owner` two-axis defect closed tonight: the guard sits where the population is empty
and is missing where it is real.

MEASURED, by reading the two gates and the close body (spec-cli/src/sessions.ts):

  assertQueuedRetirementSafe   (never-launched session)
    dirty worktree             -> refuse  "prepared worktree has dirty work"        :3203
    rev-list --count base..br  -> refuse  "prepared branch is N commit(s) ahead"    :3210

  assertColdRetirementSafe     (archived session — one that actually ran)
    tmux window reappeared, rendezvous transport live/unproven, leaf PID owned or unknown,
    adapter thread loaded, shared-root residency census unhealthy, cold witness stale -> all refuse
    anything about dirty files or unmerged commits                                    -> ABSENT

  then, unconditionally:
    git worktree remove --force <path>    :3242
    git branch -D <branch>                :3250

`-D` is the point. git's own refusal exists for exactly this class, and the product spells past it:

  $ git branch -d unmerged
  error: the branch 'unmerged' is not fully merged.
  If you are sure you want to delete it, run 'git branch -D unmerged'

So the realistic loss is not exotic: a session commits, proposes a merge, the human never merges it, someone
closes the session. The queued gate would have refused that same branch for being one commit ahead; the
archived path, where the commits are the entire reason the session existed, deletes them.

The guidance layer already compensates by hand, which is the tell that the check is computable and simply not
consulted: the distill skill tells a human to verify "the salvage is present (or the branch truly merged)"
BEFORE `spex session close`, and to keep the resources if proof is incomplete. Prose is carrying an invariant
the code could compute — the ahead-count is the same `rev-list --count` the queued gate already runs, and the
declare gate computes both readings too (:2552 dirty, :2562 ahead), so no new mechanism is needed.

WHERE THE WORK GOES AFTERWARD — measured in a throwaway repo, no real lane touched:

A commit that loses its last ref is not destroyed, but which instrument can still NAME it changes twice, and
each tier is blind to the cell just outside it:

  refs      git log --all -S / for-each-ref --contains   NO — walks refs, and an unreffed commit has
                                                         none by construction
  reflogs   git log -g -S                                yes, until the reflog FILE is deleted
  objects   git fsck --unreachable                       yes, until gc — "dangling commit e8817874…",
                                                         and git show still retrieves the diff

The middle tier expires far earlier than the 30 days everyone quotes, because a lane's reflog is not in the
shared logs directory:

  .git/worktrees/<lane>/logs/HEAD      <- inside that worktree's own admin directory

`git worktree remove --force` deletes that directory, so close is itself the expiry event. Measured: before
removal `git log -g` finds the sha; after removal every ref/reflog search is silent while `cat-file -t` still
answers `commit`. The correct move on finding yourself in that cell is therefore not "remember `-g`" but
`git branch backup/x <sha>` at once — a reflog is a lease whose expiry event is lane teardown, and it expires
with no warning.

NOT MEASURED, stated rather than implied: no live close was run against a dirty or unmerged archived session.
That needs a real session and destroys its work, which is the thing under discussion. This is a code-path
reading plus an independent measurement of what git does at each step — not an observed loss.

REPAIR, cheapest first:
  1. On the archived path run the two readings the queued path already runs, refusing in the same voice
     ("N commit(s) ahead", "dirty work"); an explicit force override may proceed, out loud.
  2. If removal proceeds anyway, print the shas about to lose their last name, so the object tier stays
     reachable by a human rather than only by fsck.
  3. Prefer `-d` and treat its refusal as the signal, instead of reimplementing the check beside `-D`.
