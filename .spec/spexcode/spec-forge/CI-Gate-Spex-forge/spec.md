---
title: CI-Gate-Spex-forge
status: design
hue: 280
desc: The CI Gate — turns any external PR into a reviewed object judged against spec intent, then writes the verdict back to the forge. Generalizes review-proof from internal sessions to arbitrary PR branches and adds the one write-seam spec-forge deliberately lacks. Design-only; no code yet.
related:
  - spec-forge/src/port.ts
  - spec-yatsu/src/proof.ts
  - spec-cli/src/sessions.ts
---
# CI-Gate-Spex-forge

A design contract (not yet implemented). It marries the two halves the tree already carries: [[ci-gate]]
(the non-bypassable CI backstop running `spex lint` + `tsc`) and [[spec-forge]] (the read-only forge
tracer that resolves an issue/PR to the node it serves). The gap between them is the whole node:

> take the **[[review-proof]]** derived-evidence model — today fed only by an internal session's worktree —
> generalize its root to **any PR branch**, add an **agentic conformance verdict** on top, and write that
> verdict **back to the forge's execution plane** (a Check + a sticky comment).

This is the LLM judge [[spec-lint]] explicitly deferred: lint keeps the spec↔code *graph* honest in the
commit path; whether the code still honors what the spec *says* is judged here, async, on the forge.

## the pipeline — determinism first, agency only where meaning must be judged

A forge event (PR opened/synchronized) runs `spex forge gate <PR>` in CI. Four layers:

- **Tier 0 — deterministic, blocking.** Reuse [[ci-gate]] / [[manager-cockpit]]'s gates: `spex lint`
  errors + `tsc --noEmit` + `conflictsWithMain` (the `git merge-tree` dry-run, no checkout). Red here
  fails before any agent runs — cheap, no LLM.
- **Tier 0.5 — deterministic, signal.** The **spec-touch matrix**: route each merge-base-diff file to its
  node via the `code:` graph, then classify `(spec touched?, code touched?)` per node. The load-bearing
  cell is *code changed / spec untouched* — invisible to Tier 0, the silent-divergence the dogfood
  forbids.
- **Tier 1 — agentic, the verdict.** One judge **per touched node** (not one agent over the whole PR).
  Each is fed the node's spec body + its parent/siblings/children (intent is only legible against the
  tree), the node's slice of the diff (already grouped by [[review-proof]]), and the node's yatsu
  scenarios. It returns a **structured** verdict — `{ verdict: conforms | diverges | spec-missing,
  severity: block | warn | note, rationale, evidence }` — never free text.
- **Tier 2 — agentic, optional (default off).** On `diverges`/`spec-missing`, propose the spec edit or
  missing yatsu scenario that *should* accompany the change, as a forge **suggestion** — never an
  auto-push, never an auto-merge.

## how agentic — bounded and structured, not a放养 review bot

Determinism owns everything mechanical (touch matrix, lint, typecheck, conflict); the agent appears only
to judge meaning. Each judge has bounded input and a closed-schema output, parallel across nodes, skipped
for PRs that touch no governed node. The gate is **read-mostly**: it judges and writes a verdict; it never
pushes a commit, never auto-merges, and — the invariant below — never writes a node's status.

## the load-bearing decision — writing back does NOT break the read-only contract

[[spec-forge]]'s铁律 is "never write a node's **git-derived status/version**". A Check Run and a PR comment
are the forge's **execution plane**, not the spec graph. The verdict never sets a node's version or status;
a merge still flows back only through git. So the write-seam is a *new capability axis*, not a violation:
definition (the graph) and execution (the forge) stay un-crossed, exactly as the [[port]] requires.

## surfaces — reuse, near-zero new display

- **CLI:** `spex forge gate <PR>` — the orchestration entrypoint CI calls.
- **Dashboard:** a PR **review泳道** beside sessions-in-review, a PR badge on each touched node (the open-PR
  badge [[dashboard-issues]] deferred), and a PR proof overlay — [[review-proof]]'s model rooted at the PR
  ref instead of a session worktree, with the conformance verdict layered on. The CI gate is the headless
  twin of the [[manager-cockpit]] review a human runs.

## host adaptation — host-agnostic core, thin per-host drivers

The judge and the touch matrix are pure and host-agnostic; only read/write touch a vendor.

- **The write-seam (new):** keep the tracer read-only; add explicit write verbs (`postCheck`,
  `upsertStickyComment`) — either on the [[port]] or a sibling gate-writer. A second host is one registry
  entry, the promise [[forge-cli]] already keeps for reads.
- **GitHub:** read via `gh` (ready); write via `gh api` (Checks) + `gh pr comment`. Extend `ci.yml` with a
  `pull_request` job (`fetch-depth: 0`) → `spex forge gate`; grant `pull-requests: write` + `checks: write`;
  add `ANTHROPIC_API_KEY` secret. A live dashboard rides [[freshness]]'s deferred webhook source.
- **GitLab:** a `gitlab` driver (API / `glab`); a `merge_request_event` CI job; write-back = MR note +
  commit status. Real need: the self-hosted z-code instance.

## scope

Out of scope until the build decision lands: the implementation itself (this is design-only), the second
(GitLab) driver beyond the abstraction, and any auto-remediation beyond a Tier-2 suggestion. This node owns
the **contract**; [[ci-gate]] still owns the deterministic backstop, [[review-proof]] the evidence engine,
[[spec-lint]] the graph rules.
