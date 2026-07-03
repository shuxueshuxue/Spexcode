---
title: deliver-port
status: pending
hue: 145
desc: PENDING design — `done` becomes one verb, `deliver(worktree) → destination`, over a port with three drivers (trunk = dispatch-merge, forge = a PR, verdict = a Check+comment). The merge ritual reconnects to the forge without a private "proposal" noun. No code yet.
related:
  - spec-cli/src/sessions.ts
---
# deliver-port

## raw source

SpexCode's merge ritual is a **pull request in all but name** — branch → review → merge to a protected
trunk → delete branch — but built as a private, local, in-process rite that the forge world can't see or
join. The same mistake the local issue made against the forge issue, one layer up. The fix is not to
rebuild the merge engine; it is to notice that `done --propose merge` is one instance of a more general
act — **delivering a finished worktree to wherever that work is meant to land** — and to let the landing
place, not the merge mechanism, be the thing that varies.

## expanded spec

**`done` collapses to one verb: `deliver(worktree) → destination`.** The session no longer knows *how* a
delivery happens; it knows only *where* the work lands. Three landing places sit behind one **deliver
port**, each a driver — and because the branch point lives at the adapter boundary (not in an
`if origin ==` scattered through the lifecycle), this is one mechanism, not a special-case per usage:

- **trunk** — today's [[dispatch|dispatch-merge]] verbatim: the session's own agent runs the `--no-ff`
  merge into the trunk, resolving conflicts because it holds the intent. Unchanged; the default; the fast
  offline path the tight loop lives on.
- **forge** — push the branch and open/update a **pull request** ([[forge-write-seam]] grows into this
  driver's PR write verbs). The outward half: our work becomes a PR the ecosystem reviews.
- **verdict** — a read-only delivery: a conformance judgement posted back to a PR as **both** a CI Check
  (the machine gate) and a sticky comment (the human read), through the same forge write verbs
  ([[conformance-judge]] / [[forge-gate]] become this driver). The inward half: an external PR, pulled in
  as a session ([[session-origin]]), is reviewed and its verdict returned — with no merge rights required.

**Destination is chosen at session birth and is SINGLE-valued — not a v1 shortcut but the correct model.**
A delivery changes the *ownership* status of a work unit, and a work unit has exactly one ownership
terminal state, so a set of destinations would make "who owns this now" a set-inference the admission
gates ([[main-guard]] / conformance) could not anchor to. The tempting counterexample — "merge to trunk
AND update a tracking PR" — is not two deliveries: the real delivery is `deliver(trunk)`; the PR update is
a **mirror**, the forge merely reflecting a fact git already owns. Mirroring is the **read-side job the
[[spec-forge]] tracer already does** (git/`.spec` is the single source of truth), and it never enters the
deliver port. So the deliver/mirror split is what keeps destination single: *deliver changes ownership;
mirror observes it.*

**Origin and destination are orthogonal.** Where a worktree was *seeded* ([[session-origin]]: fresh vs
pulled-from-PR) is a construction parameter, forgotten after seeding; where it *lands* is the persistent
field `done` routes on. The awkward table this design started with — different `done` semantics per origin
— dissolves: "an external PR that we, as maintainer, decide to accept" is not a special case but the
ordinary coordinate `origin:pr × destination:trunk`, and the trunk driver's admission gate (acquire the
PR's intent + pass conformance, *then* dispatch-merge) applies to every author identically — where the
"the agent wrote it, so it knows the intent" premise weakens, the gate is what strengthens.

The `--propose nothing` / `--propose close` paths are not deliveries and are untouched; only the merge
path converges onto the port. Retargeting a live session's destination (start trunk, later decide it needs
external review → forge) is a deliberate non-goal of the first cut: destination is fixed at birth.
