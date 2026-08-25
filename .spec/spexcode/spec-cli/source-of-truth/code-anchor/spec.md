---
title: code-anchor
status: active
hue: 15
desc: A code: entry may pin named units (`path#symbol` selectors, any number, one base file, OR'd); drift touching any pinned unit is the BLOCKING tier (one anchor-drift error naming hit selectors), replacing the retired count-based driftErrorThreshold gate. related: selectors warn on hit, stay silent on miss. Anchors are optional — an unanchored node never blocks.
code:
  - packages/spec-core/src/anchors.ts#runAnchorQueries
  - packages/spec-core/src/anchors.ts#anchorHitQueries
  - packages/spec-core/src/anchors.ts#anchorHitExists
  - packages/spec-core/src/anchors.ts#anchorHitCommits
  - packages/spec-core/src/anchors.ts#resolveAnchor
related:
  - scripts/anchor-drift-golden-proof.mjs
  - scripts/anchor-drift-fold-proof.mjs
  - spec-cli/src/anchors.test.ts
  - spec-cli/src/lint.ts
  - packages/spec-core/src/git.ts
  - spec-cli/src/git.test.ts
  - packages/spec-core/src/specs.ts
  - spec-cli/src/lint-scoped.test.ts
  - spec-cli/src/commit-gate.test.ts
  - spec-cli/src/guide.ts
  - spec-cli/templates/hooks/commit-msg
  - spec-cli/templates/hooks/reference-transaction
---
# code-anchor

## raw source

Count-based drift gating ("3 commits behind blocks") measures the wrong thing: commit COUNT says
nothing about whether the spec's contract was touched. The honest block criterion is spatial — a spec
pins the unit of code that carries its contract, and only a change INSIDE that unit blocks. So a
`code:` entry may carry an anchor, `path#symbol`, and the gate asks one question: did any commit since
the spec's last version intersect the anchored unit's lines? Anchors are optional: an unanchored node
keeps today's advisory-only drift, forever.

## expanded spec

**Vocabulary.** An anchor names one top-level unit: a function, an arrow/const declaration (data
too), a class, an enum, or a class method (`#Class.method`). A type/interface resolves but
warns — anchoring a type is usually wrong. A `code:` entry may carry **any number of selectors, all on
the same exact base file** — measured evidence: the drift-replay benchmark's multi-anchor roster (its
1–3 cap was annotation rubric, never product syntax — no selector-count cap exists).
Selectors are **OR**: a commit hitting any blocks, counted **once**, the diagnostic naming the hit
selectors. One-govern counts **distinct base paths** — cross-file selectors stay an error,
multiple specs pinning one file stay ordinary. One structured parser reads both relations, refusing
loud: duplicates, bare+scoped mixing, a selector on a glob/directory. Anchor verdicts
are equally **loud, never silent**: dead (deleted/renamed — follow the rename or fix the spec),
ambiguous (two same-named units), an unparseable current file, a language with no designated
extractor, or an extractor that cannot run here — each a lint **error** naming its repair. When an
extractor cannot run, the error also records that those anchors were skipped and remain unverified;
the rest of lint continues, but the non-zero result cannot be reported as a pass.

**That verdict is decided in ONE place, for every reader.** Two readers ask it: the gate, judging the
candidate TIP it is about to admit, and the eval freshness probe, judging the WORKING tree to decide whether
a reading may still testify. Which text each reads is genuinely its own — a gate that judged a dirty worktree
would admit a commit it never inspected — but the classification is not, and while each branched on
dead/ambiguous itself the two had already drifted: the gate warned on a type-only unit, the probe never
noticed one. So the per-selector verdict comes from one classifier and only the WORDING belongs to each
caller. The failure this forecloses is the one that would be silent: a selector the gate calls dead while the
freshness signal still treats its reading as testifiable — a measurement presented as valid for code whose
anchor the gate has already rejected.

**Scoped govern vs the file.** A scoped governor claims named units, not the whole file: it stays out
of the too-many-owners bound ([[governed-related]]) though `spex spec owner` still shows it as
scoped. A scoped file's **miss** keeps the ordinary advisory drift warn by default; the
committed `lint.scopedCodeMiss: "ignore"` (`spex guide settings`) silences only that advisory — never
hit blocks, bare `code:` drift, integrity, acks, related semantics, or eval freshness. A `related:` row
may carry selectors too: a hit is a soft warn naming the selector, a miss is silent; related stays
never-block, never-ack, no eval freshness.

This vocabulary is READ by a second consumer with its own window: an eval scenario's `code:` axis
([[eval-core]]), which narrows a reading's staleness to the units it actually measures. The parse,
extractor registry, resolution and hunk∩range engine are shared verbatim — there is no second anchor
syntax — but the two windows are deliberately different, because they answer to different subjects. Spec
drift asks about a NODE and so subtracts `Spec-OK` acks; eval freshness asks about a READING, which an ack
never vindicates, so it takes the plain ancestry window. A selector verdict this side is never a block
either: eval's whole lint layer is advisory, and a dead or ambiguous selector there stales its reading
rather than stopping a commit.

Exact impact projection is a third consumer of the same event/project/range seam. Its base→head window does
not subtract `Spec-OK`: it asks what the session changed, not whether a node acknowledged drift. A declaration
on either side names an identity at that exact revision; the shared rename DAG projects it and every immutable
event to the same terminal lineage keys, including deleted lineages and incomparable forks. Git window or hunk
failure makes the projection unavailable, never an empty miss.

**Judgment.** The window is the spec's last version → the tip being judged: `HEAD` for an ordinary
report/CI run, and a pending commit for a locally-authored candidate. It is the same ack-filtered set
[[drift-by-ancestry]]'s walk already derives. Per ordinary window commit, `--unified=0` hunks are
intersected with both immutable images of the unit: added lines against the result revision, deleted lines
against the parent revision. The event retains both historical paths, so a later current-name projection
never erases the preimage of a rename or deletion. A merge contributes only individual lines in its dense
combined (`--cc`) diff that differ from **every** parent: an all-`+` prefix is intersected with the result
unit; an all-`-` prefix must intersect the same selector's unit in every parent. `--combined-all-paths`
retains renamed merge parents. A mixed prefix such as `+ ` is inherited from at least one parent and stays out,
even when an adjacent all-parent line puts both inside the same combined hunk. A clean transport merge has
no owned line and stays neutral; a first-parent diff is deliberately forbidden because it would charge the
merge again for already-attributed side-branch work. The same line-level predicate decides whether a merge
changed `spec.md` and therefore created a version. A historical file version the extractor cannot
parse counts as a
**conservative hit**, flagged as such — over-warn beats silently missing a real change.

**Algebraic boundary.** The exact verdict is an event fold followed by a tip-relative projection and
filter, not a bounded `(version, debt)` collapse. The fold accumulates immutable spec-version,
governed-hit, acknowledgement and rename events. At the tip, rename identity is projected to the current
node, [[drift-by-ancestry]]'s full-history walk chooses ONE base from the maximal antichain of reachable
versions, and ancestry plus acknowledgements filters the retained hits against that base. Incomparable
versions have no join in reachability order; the walk-newest choice is a product rule, not a semilattice
upper bound. The frontier operation itself is maximal union of parent frontiers; an authored spec change
at a commit replaces that node's frontier with the commit, while a clean transport merge contributes no
version event.

The information lower bound is concrete. Let one branch contain an anchored hit `h` followed by version
`vB`, let its sibling contain version `vA`, and merge them without authoring a new spec line. Both parent
tips report zero findings, but if the full-history walk selects `vA`, `h` is not reachable from that version
and becomes debt at the merge. The hit history and the no-hit control produce the same pair-wise parent
states `(vA, empty)` and `(vB, empty)`, yet their merge verdicts differ, so no join over only `(v, D)` can
recover the correct answer. The exact representation must retain `h` (or equivalent growing information) until read-time filtering; a later merge-authored spec
version does collapse the frontier to that descendant, but the frontier width is unbounded between such
commits. Replacing the single base with "covered by any frontier version" would form a semilattice, but
would change this contract by letting one branch's version pardon another branch.

Renames add the same cost-conservation boundary on identity. A historical `(commit, path)` event is stable,
while its current node is not. The DAG relation is a complete three-way judgment: a rename before the event
means the old path was reused; the event before the rename moves its lineage to the target; incomparable
branches retain the event-side path and follow the rename-side target, so one lineage can fork across current
paths. A clean merge can own zero all-parent
lines yet make arbitrarily many side-branch keys reachable. Materializing those keys charges the write;
keeping only parent pointers charges the later read. The walk does not disappear, it moves. The exact,
no-semantic-change route is therefore an incrementally maintainable event index plus read-time rename
projection and reachability/ack filtering; it may reduce repeated reconstruction, but it cannot promise
bounded state or history-independent `O(1)` verdict reads.

The board's cold/full build must remain materially below the graph stream's patrol interval. Patrol is a
last-resort self-healing invalidation; when a build outlives that interval, patrol can invalidate the still
running build and amplify latency indefinitely. The index cost therefore protects both commit acceptance and
dashboard liveness; changing the patrol period alone only moves the threshold.

**Two consumers ask two different questions of this engine, and they enter through different doors rather
than through one call carrying a mode flag.** ENUMERATION — spec drift and exact impact — IS the per-commit,
per-selector list, so it must scan its whole window; that list is what names the debt an author must answer.
EXISTENCE — an eval reading's anchor axis, whose entire verdict is one bit ([[eval-core]]) — is discharged by
the FIRST hit, and scanning past it computes rows nobody reads. Existence is order-independent (a window
either holds a hit or it does not), so stopping early cannot change a verdict; what it must never do is
report "not found yet" as "no hit", so a window is settled only by a hit or by having been scanned to its
end. Because which event hits is unknown until its images are parsed, the existence demand set is DISCOVERED
rather than declared: the scan advances in rounds that still ask the whole unsettled corpus at once, doubling
their width so the round count is bounded by hit DEPTH and never by how many readings were asked. A round
narrowed to one node or one reading would re-fork the batch per unit — the same inversion [[hunk-ranges]]'s READ-is-the-unit
rule forbids. Enumeration takes its remaining window in a single slice and so keeps the one-round shape
it has always had. Measured on the reference corpus, the two questions differ by 1,158 parsed file revisions
(52.6 MB) versus 307 (21.9 MB) for the same 858 booleans.

**Where the rest of the engine lives.** The pinned range semantics and image identity behind every hunk read
are [[hunk-ranges]]'s; the language seam — extractors as data rows over one Tree-sitter runtime, the memo key,
the declaration vocabulary — is [[anchor-extractors]]'s; the local ref-scoped gate that judges a pending commit
before its ref advances is [[candidate-gate]]'s; and the measured bounds on the reference history plus the
oracle discipline any faster implementation must pass are [[anchor-proof]]'s.
