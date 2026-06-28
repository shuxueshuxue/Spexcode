---
title: CI-Gate-Spex-forge
status: pending
hue: 280
desc: PENDING design — the forge CI Gate. Turns any external PR into a reviewed object judged against spec intent, then writes the verdict back to the forge. The scoping parent; its four children own the new capabilities. No code yet.
related:
  - spec-forge/src/port.ts
  - spec-yatsu/src/proof.ts
  - spec-cli/src/sessions.ts
---
# CI-Gate-Spex-forge

A **pending** design contract — the scope, not the implementation. It marries the two halves the tree
already carries: [[ci-gate]] (the non-bypassable CI backstop running `spex lint` + `tsc`) and
[[spec-forge]] (the read-only forge tracer that resolves an issue/PR to the node it serves). The gap
between them is the whole node:

> take the **[[review-proof]]** derived-evidence model — today fed only by an internal session's worktree —
> generalize its root to **any PR branch**, add an **agentic conformance verdict** on top, and write that
> verdict **back to the forge's execution plane** (a Check + a sticky comment).

This is the LLM judge [[spec-lint]] explicitly deferred: lint keeps the spec↔code *graph* honest in the
commit path; whether the code still honors what the spec *says* is judged here, async, on the forge.

## the pipeline this parent scopes — determinism first, agency only where meaning must be judged

A forge event (PR opened/synchronized) runs `spex forge gate <PR>` in CI. Four layers:

- **Tier 0 — deterministic, blocking.** Reuse [[ci-gate]] / [[manager-cockpit]]'s gates: `spex lint`
  errors + `tsc --noEmit` + `conflictsWithMain` (the `git merge-tree` dry-run). Red here fails before any
  agent runs — cheap, no LLM.
- **Tier 0.5 — deterministic, signal.** The **spec-touch matrix**: route each merge-base-diff file to its
  node via the `code:` graph, then classify `(spec touched?, code touched?)` per node. The load-bearing
  cell is *code changed / spec untouched* — the silent divergence the dogfood forbids.
- **Tier 1 — agentic, the verdict.** One judge **per touched node**, structured output. Owned by
  [[conformance-judge]].
- **Tier 2 — agentic, optional (default off).** On `diverges`/`spec-missing`, propose the spec edit or
  missing yatsu scenario as a forge **suggestion** — never an auto-push, never an auto-merge.

## the load-bearing decision — writing back does NOT break the read-only contract

[[spec-forge]]'s rule is "never write a node's **git-derived status/version**". A Check Run and a PR comment
are the forge's **execution plane**, not the spec graph. The verdict never sets a node's version or status;
a merge still flows back only through git. So the write-seam is a *new capability axis*, not a violation —
definition (the graph) and execution (the forge) stay un-crossed, exactly as the [[port]] requires.

## the decomposition — what each child owns

- **[[forge-write-seam]]** — the write verbs the read-only [[port]] lacks (post a Check, upsert a sticky
  comment), behind the same host-agnostic seam.
- **[[conformance-judge]]** — the per-node agentic intent verdict (Tier 1) and its deterministic Tier-0.5
  spec-touch input. The agentic core.
- **[[forge-gate]]** — the `spex forge gate <PR>` orchestration + the CI workflow that runs it; also the
  one change to [[review-proof]]/[[manager-cockpit]] that generalizes the evidence root from a session
  worktree to any PR ref.
- **[[dashboard-prs]]** — the dashboard surface: a PR badge, a review lane, a PR proof overlay (the
  open-PR sibling [[dashboard-issues]] deferred).

## scope

The whole subtree is **pending** — design only, no code. Out of scope until a build decision: any
implementation, the second (GitLab) driver beyond the abstraction, and any auto-remediation past a Tier-2
suggestion. This parent owns only the cross-cutting shape and the load-bearing decision; the children own
the slices; [[ci-gate]] still owns the deterministic backstop, [[review-proof]] the evidence engine,
[[spec-lint]] the graph rules.
