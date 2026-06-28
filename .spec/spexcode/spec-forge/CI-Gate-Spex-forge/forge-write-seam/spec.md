---
title: forge-write-seam
status: pending
hue: 280
desc: PENDING — the write verbs the read-only forge port lacks. A host-agnostic seam to post a Check Run and upsert a sticky PR comment, so the gate's verdict reaches the forge's execution plane. github via gh, gitlab later. No code yet.
related:
  - spec-forge/src/port.ts
  - spec-forge/src/drivers/github.ts
---
# forge-write-seam

The one capability [[spec-forge]] deliberately omitted: a **write** path to the forge. The [[port]] today
is read-only (`listIssues` / `listPRs`); the CI Gate needs to publish a verdict back. This node adds that
behind the **same host-agnostic seam** — the name is the seam, never the vendor — so a second host stays
one registry entry.

**Two write verbs, vendor-neutral:**

- **post/refresh a Check** — a single pass/fail/neutral status object keyed to the PR's head commit, so the
  gate's outcome rides the forge's native CI signal (and can gate merge where the host allows).
- **upsert a sticky comment** — one comment per PR carrying the structured conformance report, *edited in
  place* on re-runs (keyed by a hidden marker) so a busy PR never accretes a wall of bot comments.

**Why this is not a read-only violation.** A Check and a comment are the forge's **execution plane**. The
contract [[spec-forge]] protects is "never write a node's git-derived **status/version**" — and this never
does. Definition stays in the graph, flows back only through git on merge; this writes only execution
output. The two planes stay un-crossed (see [[CI-Gate-Spex-forge]]).

**Drivers behind the seam.** The first is **github** (extends the existing `gh` driver: `gh api` for the
Checks endpoint, `gh pr comment` for the sticky comment). A **gitlab** driver (MR note + commit status)
follows later as one more registry entry. The host-agnostic caller ([[forge-gate]]) never names a vendor.

It **fails loud**, like the read driver: a missing/unauthorized token throws with the host's own message
rather than silently dropping the verdict.

Out of scope: the verdict's *content* ([[conformance-judge]]), the orchestration that calls these verbs
([[forge-gate]]), and the gitlab driver's implementation.
