---
title: dashboard-prs
status: pending
hue: 280
desc: PENDING — the dashboard surface of the CI Gate. A PR badge on each touched node, a PR review lane beside sessions-in-review, and a PR proof overlay (review-proof rooted at the PR ref, with the conformance verdict layered on). The open-PR sibling dashboard-issues deferred. No code yet.
related:
  - spec-forge/src/resident.ts
  - spec-dashboard/src/SpecNode.jsx
  - spec-yatsu/src/proof.ts
---
# dashboard-prs

The dashboard half of [[CI-Gate-Spex-forge]], and the open-PR sibling [[dashboard-issues]] explicitly
deferred ("surfacing open **PRs** the same way" — out of scope there, this node here). Near-zero new
display: it reuses the surfaces that already exist.

**Three surfaces, all reuse:**

- **PR badge** — on each node a PR touches, a glance badge like the open-issue badge, in its own hue so the
  status dot / drift badge / issue badge / PR badge never blur. Fed the same way issues are: folded onto
  `/api/graph` from the resident [[freshness]] cache (open PRs already read there as session/overlay
  state — this makes them a node-bound count).
- **PR review lane** — open PRs in the gate shown beside sessions-in-review, each carrying its gate verdict
  (`pending / conforms / diverges / blocked`). The CI gate is the headless twin of the
  [[manager-cockpit]] review a human runs, so the two belong in one lane.
- **PR proof overlay** — clicking a PR opens [[review-proof]]'s overlay unchanged, rooted at the PR ref
  ([[forge-gate]]'s generalized root) instead of a session worktree, with [[conformance-judge]]'s per-node
  verdict layered on the diff.

**Two planes, unchanged.** A node *defines*; a PR *does*. The PR appears **beside** the node, never *as*
node state — a node's status stays git-derived. Silent by construction with no forge/`gh`, exactly like
[[dashboard-issues]].

Out of scope: the verdict content ([[conformance-judge]]), the gate orchestration ([[forge-gate]]), and any
live webhook push (that is [[freshness]]'s deferred source layer). Frontend is asserted by contract — there
is no browser/e2e harness here.
