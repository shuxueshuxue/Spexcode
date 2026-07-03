---
title: forge-gate
status: pending
hue: 280
desc: PENDING — the capstone. `spex forge gate <PR>` orchestrates Tier 0 → 0.5 → 1, then publishes the verdict; the CI workflow runs it on every PR. Also the one change that generalizes the review-proof evidence root from a session worktree to any PR ref. No code yet.
related:
  - spec-cli/src/cli.ts
  - spec-yatsu/src/proof.ts
  - spec-cli/src/sessions.ts
  - .github/workflows/ci.yml
---
# forge-gate

The orchestration of the [[deliver-port]] **verdict driver** ([[CI-Gate-Spex-forge]]) — an external PR
reaches it as a [[session-origin]] `pr` session, and this is the entrypoint that makes the gate run and the
verdict land.

The capstone of [[CI-Gate-Spex-forge]] — the entrypoint that makes the gate *run* and the verdict *land*.

**The orchestration.** `spex forge gate <PR>` sequences the pipeline the parent scopes: Tier 0 (reuse
[[ci-gate]] / [[manager-cockpit]] gates — lint errors, `tsc`, `conflictsWithMain`), then Tier 0.5 + Tier 1
([[conformance-judge]]), then publish via [[forge-write-seam]] (a Check + a sticky comment). Determinism
short-circuits: a red Tier 0 fails the gate before any judge runs. It is **host-agnostic** — it names no
vendor, only the seam.

**The one engine change it requires.** [[review-proof]] and [[manager-cockpit]]'s `reviewPayload` build
their evidence rooted at a **session worktree**. The gate needs the same model rooted at an **arbitrary PR
ref** (checked out in CI), so a PR with no SpexCode session is still a first-class review object. That is a
small, honest generalization of the evidence root — the model, faces, and gates are otherwise reused
whole. (PR-as-review-object is described here rather than as its own node because it is one parameter on an
existing engine, not a new concern.)

**Where it runs.** The CI workflow is the non-bypassable host. On GitHub: extend `ci.yml` with a
`pull_request` job (`fetch-depth: 0`, so the judge sees the merge-base diff and lint's version timeline)
that runs `spex forge gate ${{ github.event.number }}`; grant `pull-requests: write` + `checks: write`; add
the `ANTHROPIC_API_KEY` secret the judge needs. On GitLab: a `merge_request_event` job runs the same verb.

**Read-mostly, like the rest.** The gate judges and publishes; it never pushes a commit, never auto-merges,
never writes a node's git-derived status. A human (or the PR author) acts on the verdict.

Out of scope: the verdict content ([[conformance-judge]]), the write verbs themselves
([[forge-write-seam]]), the dashboard surface ([[dashboard-prs]]), and any auto-remediation.
