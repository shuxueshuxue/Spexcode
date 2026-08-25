---
title: hunk-ranges
status: active
hue: 15
desc: A hunk's identity is the ordered images Git actually diffed plus a pinned presentation (histogram, zero context, no textconv, no colour), never a commit id; misses are batched per READ and retained as immutable range facts in the source-of-truth ledger.
code:
  - packages/spec-core/src/anchors.ts#RANGE_SEMANTICS
  - packages/spec-core/src/anchors.ts#ABSENT_IMAGE
  - packages/spec-core/src/anchors.ts#hunksAt
  - packages/spec-core/src/anchors.ts#hunksAtMany
  - packages/spec-core/src/anchors.ts#hunkRecordsInto
  - packages/spec-core/src/anchors.ts#hunkMemoKey
  - packages/spec-core/src/anchors.ts#rememberHunks
related:
  - packages/spec-core/src/git.ts
  - spec-cli/src/anchors.test.ts
  - spec-cli/src/git.test.ts
---

# hunk-ranges

[[code-anchor]]'s verdict is a hunk∩range intersection, so it is only as honest as the hunk. This node pins what a
hunk IS — which images, presented how — and how the readers that own that identity batch and remember it.

**A commit id is not an identity for any of them, and this is a correctness rule before it is a cost rule.**
What decides a hunk is the pair of images Git actually diffed and how Git was asked to present that diff, and
BOTH are mutable behind a fixed commit id: `refs/replace` swaps the object a commit id names, a graft or an
unshallow changes its parents, and a `.gitattributes` `diff` attribute — read from the WORKING TREE even for
historical diffs — decides whether Git emits `@@` at all or calls the path binary. Measured: one commit and
path yield one hunk bare and ZERO under `-diff`, so an anchored contract's drift was silently unblockable by
an attribute edit, and any store keyed on `(commit,path)` could serve either answer.

So this engine fixes both halves, inside the readers this node owns. RANGE SEMANTICS are PINNED on those
readers across every class of ambient state that decides a boundary or the parse: presentation (text, no
textconv, no external driver), the algorithm and its heuristics (an explicit algorithm, no indent heuristic —
both otherwise repository config), hunk coalescing (inter-hunk context zero), rename candidacy (rename
detection with no candidate limit), and COLOUR. Colour belongs in that list because it is the sharpest of
them: under an ambient `color.ui=always` Git prefixes every hunk header with an ANSI escape, a header parse
then matches NOTHING, and the engine reports no drift for every anchored path — a silently clean blocking gate
for anyone whose global Git config turns colour on. Measured: two hunks become zero. Pinning colour off is
therefore a correctness requirement of the gate, not tidiness. Identity is the ORDERED IMAGES —
the result image and each parent image, in order, each named by its resolved blob oid and historical path — so
replace, graft and unshallow all move the identity and are re-read, while an unchanged image set is reused.
Those oids are already resolved by the read's one `cat-file --batch-check`, so completeness adds no child, no
state and no second store. The algorithm's VALUE is itself a product decision, because the algorithms
genuinely disagree about which lines an edit authored: measured, `c a c a` becoming `c c a a a` has myers
authoring new lines 4–5 while histogram authors new lines 2–3, so a unit on line 3 is a HIT under one and a
MISS under the other for the same commit. **histogram** is pinned, because it aligns an edit with the unit
that actually moved, and for a BLOCKING gate the conservative reading is the honest one — Git's default myers
would silently miss that drift. A pinned algorithm therefore settles what a verdict MEANS, not merely that it
is reproducible.

**Residual, explicit: the PERSISTED merge derivation is not pinned and is not this node's.** The combined-diff
rows the history event ledger stores are produced by [[source-of-truth]]'s own streams under ambient Git
interpretation, and its schema stamp is unchanged — so a ledger row written under one interpretation stays
eligible under another, and a merge event's window membership can rest on a different reading than the range
this engine then pins. Unifying that requires the ledger's schema identity to carry the interpretation, which
is that node's contract to change and deliberately untouched here; the alternative — quietly re-interpreting
the persisted stream without moving its schema — would leave old rows eligible under new semantics, which is
worse than the split being written down.

Under that identity and this seam's pinned range-semantics schema, the demand set a batch sends Git is its
MISSES. The source-of-truth event ledger retains those immutable ranges across backend processes under the
same key: one batch reads its whole demand once, fills only absent facts, and joins them to the source-of-truth
build's already-open decoded snapshot and single atomic writer. A hunk fact carries no selector, unit, window, reachability, or verdict, so a changed
declaration still resolves and validates normally; an absent or invalid fact is recomputed loudly. The
process-local memo remains the fast path within that read. The waste that removes:
a re-lint after a single trunk commit or one dirty edit re-forked one `log --patch` per anchored path (22 on
this tree, argv byte-identical to the previous run) and re-streamed every window blob, so a consumer that
re-verdicts per tree state — [[manager-cockpit]]'s review gate — paid the whole corpus per movement. The batch
ends with that invocation; its durable range fact and local memo are per-image and hold no window, verdict or
reachability, so neither is a resident cache of results nor a second history truth, and an image set Git was
never asked about is always asked. Git access stays batch/short-lived; no resident
process. The READ is the unit deliberately: a consumer that batches something narrower — one node, one
reading — re-forks the whole batch per unit and inverts the flag's purpose, so both the spec-drift and the
eval-freshness consumers hand the engine their entire demand set at once. Batch width lengthens a queue
rather than widening one process's argument vector or output: object reads and per-commit hunk queries are
split into bounded requests whose results are order-independent, so a wider corpus costs more requests and
never a truncated or rejected one.
