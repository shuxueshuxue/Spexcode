---
concern: filing a concern invalidates the filer's own landing gate, because the only permitted place to file is the branch the gate measures against
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: issues-cli
created: 2026-08-05T22:58:55.501Z
---

Spec: issues-cli

Neither behaviour here is wrong, and both are deliberate — this is their interaction, which costs a worker one
full re-sync-and-re-prove loop per concern filed, and which two sessions hit independently tonight.

The two designed facts, quoted from the module that owns them (spec-cli/src/localIssues.ts):

  :9-11   local issue reads and writes "target the main checkout and commit STRAIGHT to it (--no-verify)"
  :11-12  "A committing write is allowed ONLY from the trunk checkout itself (isPrimaryCheckout) — a
          linked-worktree backend sharing that main is refused loud, never left to fabricate a stray commit
          on a main it doesn't own"
  :64-67  the refusal text: "committing here would land a stray issue on the REAL main and race its index"

Both are right on their own terms. Together they mean: the ONLY place a session may file is the trunk, and
filing there ADVANCES main — while the landing gate this repository requires immediately before landing is
`git merge-base --is-ancestor <base> <branch>`, measured against that same advancing main.

So a worker who records a concern immediately invalidates its own gate, by the act of recording. Measured
tonight on one branch:

  file an issue from the trunk        -> main gains c39596c93   -> --is-ancestor  NO
  merge main, re-run the product proof, re-check                -> --is-ancestor  YES
  reply to an issue from the trunk   -> main gains 4b0a7d5f1    -> --is-ancestor  NO   (again)

Three sync rounds for one fix, and each round re-runs a full product proof (242 CLI invocations here) whose
input the new commits cannot touch, because they are `.spec/.issues/*.md` and nothing else. The other session
hit the mirror image of the same seam from the other side: `spex issue reply` from its linked worktree was
refused by :64, i.e. correctly told to go do the thing that breaks its gate.

The cost is small per event and it lands exactly where honesty is expensive: a worker mid-landing is nudged
toward "file it later / don't file it" precisely when the finding is freshest, which is the opposite of what
the issues surface is for.

WHAT NOT TO DO: teach the landing gate to ignore main-advances that touch only `.spec/.issues/`. A gate that
excludes part of its base is a gate that can be walked through by putting something in the excluded path, and
the whole value of `--is-ancestor` is that it admits no exceptions.

CHEAPEST HONEST REPAIRS, in order:
  1. Guidance only, zero mechanism: file concerns BEFORE the final sync, not after. This is a documented
     ordering, not a new behaviour, and it removes the loop entirely for anyone who knows it. It belongs
     wherever the landing sequence is stated, since that is where the reader already is.
  2. If mechanism is ever wanted: let a metadata-only write land on a ref that is not the trunk's tip, so the
     issue store advances without moving the branch every gate measures against. That is a real design change
     to a module whose current shape is carefully reasoned, so it should not be taken for ergonomics alone —
     recorded here as the option, not the recommendation.

NOT MEASURED: whether the same loop appears for `spex remark` and `spex evidence put`, which may share this
store path. Only `issue open` and `issue reply` were observed advancing main.
