---
concern: cockpit evalGate reports 'unavailable' for a projection nobody built yet, and conflates that with 'nothing measured'
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: open
nodes: manager-cockpit, session-eval
created: 2026-08-05T10:29:22.695Z
---

`cockpit.ts`'s `evalGate` is a pure projection READ, and it must stay one — `buildSessionEvals()` calls
`reviewPayload()`, so building from here would recurse. The comment says so and the structure now enforces it.

The consequence is unmeasured: the only thing that creates a projection entry is `sessionEvalProjection`'s
registry `snapshot()`, driven by the graph / `/api/evals/impact` surface. So on a backend nobody has driven
that surface on yet, `spex session review` and the cockpit both report `phase: 'unavailable'` for every
session — not because there is nothing measured, but because nobody has built the projection.

Worse, `unavailable` carries two different facts today:

    if (!projection) return { phase: 'unavailable' }                        // never built
    if (projection.phase !== 'ready' || !projection.value)
      return { phase: projection.phase === 'ready' ? 'unavailable' : projection.phase }   // built, nothing to say

A reader cannot tell "this session has no measured loss" from "the loss readout has not been computed here
yet". The manager's review gate is exactly the surface where that difference matters.

Two candidate designs, neither of which should be picked without measurement:

1. **Split the phase.** Report a distinct value for "not built" and keep `unavailable` for "built, nothing
   measured". Small, honest, and it removes the ambiguity — but it widens an outward enum
   (`ReviewEvalGate['phase']`) that dashboard and CLI both switch on, so it is a contract change, not a
   default next move.
2. **Let the cockpit build it.** The cockpit already computes `reviewPayload(id)` before composing, so it
   could hand that payload down instead of letting the eval side re-enter through it — which dissolves the
   recursion structurally rather than avoiding it. But this puts a summary BUILD on a read path, and this
   repo has just finished proving (see the adopter cold-graph issue) that synchronous work added to read paths
   is what makes this product feel dead. Nobody has measured what a cold `spex session review` would cost
   with a build in it.

Filing rather than fixing: option 1 widens an outward contract and option 2 needs a cost measurement first.

The sibling finding recorded with this one — that session create could not pin a frozen canonical base — is
NOT open: `sessionCreateRequest` now accepts `base`, validates it names a real commit, pins it on the record,
and uses it as the worktree start point. Nothing to do there.

[[manager-cockpit]] [[session-eval]]
