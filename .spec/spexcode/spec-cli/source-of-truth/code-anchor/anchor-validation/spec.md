---
title: anchor-validation
status: active
hue: 15
desc: How the anchor engine is proven: measured bounds on the reference history, a positive control before any equivalence run, an oracle that does not share the projector, and every finding channel captured on every exit status.
code:
  - scripts/anchor-drift-golden-proof.mjs
related:
  - scripts/anchor-drift-fold-proof.mjs
  - spec-cli/src/anchors.test.ts
  - packages/spec-core/src/git.ts
---

# anchor-validation

A faster [[code-anchor]] implementation earns its place only against an oracle that can fail. This node holds the
reference measurements and the discipline that keeps a benchmark from agreeing with itself.

The worst-case bounds are real but loose on the reference history. Across 4,266 commits and 217 current
nodes, 160 rename events form chains of at most 4 (mean 1.51), while anchor-hit identities derived from the
complete drift event index grow from 249 at depth 1,002 to 550 at 2,497, 840 at 4,200 and 841 at the tip.
Three older series were instrumentation errors. The 198 / 458 / 748 / 749 path-limited
`rev-list --no-merges <tip> -- <current-path>` simplified away eight real single-parent hit events
(indexed-only 8, simplified-only 0). The later 202 / 466 / 756 / 757 event-indexed series still read every
historical blob through its current path and only intersected result-image ranges: it missed 86 real hits
under six pre-rename paths and one same-path deletion hit. A record-level diff found 87 additions, zero
removals, and re-proved every addition by immutable hunk-unit intersection. The 249 / 553 / 843 / 844 series
then queried an ordinary rename through only its result path, which made Git render the result as a full-file
addition. Reading both event image paths removes three false entries: two governors of one 100% rename and one
R081 rename whose actual hunks miss `blobPut` on both sides. The reference proof projects the
intended version base for all 217 nodes and compares normalized drift sets at 14 pinned tips. These measurements justify keeping the exact
event/projection architecture and reducing its constants; they do not turn its asymptotic lower bound into
a constant.

A benchmark is not an oracle until a positive control proves that it can fail. Before accepting an
equivalence run, execute one pinned case with known anchor debt and require the normalized set to contain
that debt; only then compare candidate and baseline. Capture every channel that carries findings on every
exit status. In particular, warning-only lint exits zero while writing findings to stderr, so a harness that
reads stderr only on failure turns real debt into an empty set and makes two broken measurements look equal.
The same rule excludes a fake CLI or receiver from standing in for the product surface being proved. This is
a measurement invariant: a harness that does not prove it can observe a known failure may report agreement
while both the product and the oracle are silently truncated or replaced by a fake dependency.

**Oracle boundary.** The product has one Git-derived history/projector path. A deliberately slow independent
CLI or temporary real-Git fixture may serve as the correctness oracle; an in-process duplicate that shares the
same projector cannot prove the projector itself. Correctness comparisons therefore require a positive control,
separate process/home, and normalized findings including counts. Wall-clock improvement is not implied by this
semantic equivalence.
