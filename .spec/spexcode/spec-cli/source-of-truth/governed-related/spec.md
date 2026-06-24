---
title: governed-related
status: pending
hue: 200
desc: DESIGN (not built) — split a node's code into ONE governed file (historical drift, as today) and many related files (a per-commit "glance" nudge, no drift, no ack); warn when one file has too many owners.
---

# governed-related

## raw source

A spec node's `code:` list means two incompatible things at once. For **coverage** it is a governance link
and wants to be many-to-many — every hub file claimed from each feature that reaches through it. For
**attribution** — drift, yatsu, "is this mine?" — it must be ownership and wants one owner per file. The
system stores governance but reads it as ownership, so a change to one hub file (`styles.css`, `cli.ts`)
fans a stale/uncovered signal across every co-owner. The fix is to separate the two relations — and give
them two different SIGNAL SHAPES.

## expanded spec

Split a node's files in two:

- **governed** — the file(s) the node is the SOURCE OF TRUTH for, ideally one (a cohesive cluster is fine;
  the load-bearing rule is one owner per *file*, not one file per node). Keeps today's mechanism unchanged:
  historical drift traced over commit history, persisting until `ack` or re-version. The drift engine does
  not change — it is just fed the smaller, honest owned set.
- **related** — files the node touches but does not own. **No history trace.** A diff-scoped, present-tense,
  ONE-SHOT nudge: "this commit touched files related to specs X, Y — glance at them." It never accumulates,
  and there is nothing to `ack` — it was a pointer, not a verdict. Hand-listed first; ideally DERIVED from
  the code's import graph later, so a node declares only what it owns.

**Too-many-owners warning** — the twin of the breadth warning ([[spec-lint]]), rotated to the file: a file
governed by more than one spec, especially a central/high-fan-in one, warns *"give this a single foundation
owner; relate it elsewhere."* With coverage it CORNERS every hub into one owner, so the cluster allowance
never becomes a loophole for folding a hub into a feature node.

Yatsu mirrors the split: a frontend node measures its OWN governed surface; a change to a merely-related
shared file gives a present-tense "consider re-measuring," never a standing uncovered/stale verdict.

The model surfaces at three grounding moments — first read ([[spec-first]]), first touch of each file
([[spec-of-file]], which already names owners and flags hubs live), and commit (drift/lint). Shipped so far:
`specOwners` (the file→owner resolver) and [[spec-of-file]]'s hub flag. What this node still declares: the
governed/related field split, the related nudge, and the too-many-owners lint.
