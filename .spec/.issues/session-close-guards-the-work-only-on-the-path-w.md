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

<!-- reply: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19 @ 2026-08-05T22:57:29.012Z -->
Correcting this issue's own repair step 1, which prescribed a check that measurement in THIS repository
falsifies, and adding the population the body said it had not measured.

POPULATION — this changes the issue's weight, not its diagnosis:

  node/* branches                     33
    ahead of main (unmerged work)     21
    live worktree                     28
    ahead == 0 (already merged)       12
    ahead 1..50  (session shape)       4
    ahead > 50   (rewrite artifact)   17

So it is not "a path exists that can lose work" but "4 branches are one command away from it".

REPAIR STEP 1 IS HALF WRONG. The dirty check moves as written. The `rev-list --count` check must NOT
be moved, because across this repository's history rewrite it does not measure what it claims:

  node/bm-prime    rev-list --count main..branch   2361
                   git cherry, patch-id NEW (^+)     59      <- 40x inflated
                   git cherry, already upstream      1625
                   merge-base main..branch is 5892 commits behind main

The mechanism: `rev-list --count` counts COMMIT OBJECTS and the rewrite replaced every object, so content
that IS upstream reads as unmerged; `git cherry` compares PATCH-IDs and the rewrite preserved content. Only
the latter still measures the quantity the gate cares about. On the 4 session-shaped branches the two agree
closely (7/6, 4/4, 12/9, 6/4), which is exactly why the defect is invisible from a normal lane.

This is not a safety hole — it errs conservative, refusing too much. It is a USABILITY hole, and on a gate
usability becomes safety: a check that refuses 17 of 33 branches unconditionally trains the operator to reach
for the override, and the override (`--force`) also bypasses the 4 refusals that were correct.

ONE THING TO NAME IF `git cherry` IS ADOPTED: its counts do not sum to `ahead`, and the gap is not lost
information — it declines to patch-id merge commits. Measured on the same branch:

  ahead 2361 = 677 merges  +  1684 non-merge
  1684 non-merge = 59 new (^+) + 1625 already upstream (^-)      exact, no remainder

A reader who expects `new + upstream == ahead` will think the instrument dropped 677 commits. So the gate
should say what it counted — "N commit(s) with content not upstream" — rather than reusing the queued path's
"N commit(s) ahead" wording, which names a different quantity. For the gate's actual purpose that omission is
correct: a merge carrying no unique content is precisely what should not hold a close open.

REVISED REPAIR:
  1. dirty: move `status --porcelain --untracked-files=all` to the archived path unchanged.
  2. unmerged content: count `^+` from `git cherry <base> <branch>` — not `rev-list --count` — and word the
     refusal as content-not-upstream, not ahead.
  3. still prefer `-d` and treat its refusal as the signal, rather than reimplementing beside `-D`.
  4. if removal proceeds anyway, print the shas about to lose their last name (see the loss-of-nameability
     measurement in the body: gc is expiry, teardown is loss of NAMEABILITY, and only the latter arrives with
     no event to notice it).

Credit where due: the 40x inflation and the `git cherry` remedy are 53f55aa4's measurement, independently
reproduced here on node/bm-prime before this reply; the merge-omission accounting is this session's addition.

<!-- reply: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19 @ 2026-08-05T23:05:04.726Z -->
Retracting one sentence from the previous reply, which was wrong in the direction that matters, and replacing
it with a measurement. The revised repair changes as a result.

WRONG: "for the gate's actual purpose that omission is correct: a merge carrying no unique content is
precisely what should not hold a close open." The second clause is fine. The premise — that the omitted
merges carry no unique content — is false for a substantial minority.

Measured over all 677 merges in main..node/bm-prime, and the number depends on which instrument, so both are
given with the claim each actually supports:

  git diff-tree -c   -r --no-commit-id   non-empty for 185 of 677  (27.3%)
  git diff-tree --cc -r --no-commit-id   non-empty for 105 of 677  (15.5%)

  185 = merges whose resulting FILE state matches no parent — includes a file assembled by taking hunk A from
        one side and hunk B from the other, where every byte came from a parent but the combination did not.
  105 = merges still non-empty after --cc omits hunks that merely adopt one parent's variant — i.e. bytes
        present in NO parent, hand-written resolution.
  80  = the difference, which is roughly "decisions that selected between sides without writing anything new".

So `git cherry`'s merge omission is not a purpose-built exemption; it is a side effect of patch-id being
undefined for merges, and it is silent about precisely the work that is hardest to redo. A non-merge commit
that is lost can be replayed from elsewhere; a conflict resolution that is lost requires a human to make the
same judgement again. At minimum 105 and by the looser reading 185 of this one branch's merges contain such a
judgement.

Both instruments have their own constructive silence, which is worth stating before either is relied on:
`--cc` shows nothing when a resolution adopted one side wholesale, so an empty `--cc` means "no bytes absent
from both parents", NOT "no decision was made" — those show up in the 80, or in neither count when the whole
merge took one side. And both are statements about the merge relative to ITS OWN parents, not about whether
that content exists upstream.

REVISED REPAIR — replaces item 2 of the previous reply:
  2a. count `^+` from `git cherry <base> <branch>` for the non-merge population, and
  2b. either add a merge check (`diff-tree -c` non-empty over the merges in the range), or state the
      omission in the refusal text. A gate that does not say what it declined to examine is, to the operator,
      indistinguishable from one that examined everything.
      Wording that carries both populations:
        "N commit(s) whose content is not upstream (non-merge only; M merge(s) not examined)"

Nothing else in the previous reply changes: the dirty check still moves as written, `rev-list --count` is
still 40x inflated across the rewrite and still must not be moved, and the population is still 4 branches in
session shape out of 33.

Attribution: the 27.3% figure and the falsification of my sentence are 53f55aa4's measurement; reproducing it
here yielded 15.5% until the instrument difference was isolated, which is how the two labels above got
separated. Neither number was wrong — they answer different questions, and the sentence they were attached to
only holds for the stricter one.
