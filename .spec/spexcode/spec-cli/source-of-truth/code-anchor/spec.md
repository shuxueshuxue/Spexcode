---
title: code-anchor
status: active
hue: 15
desc: A code: entry may pin named units (`path#symbol` selectors, any number, one base file, OR'd); drift touching any pinned unit is the BLOCKING tier (one anchor-drift error naming hit selectors), replacing the retired count-based driftErrorThreshold gate. related: selectors warn on hit, stay silent on miss. Anchors are optional — an unanchored node never blocks.
code:
  - packages/spec-core/src/anchors.ts#RANGE_SEMANTICS
  - packages/spec-core/src/anchors.ts#ABSENT_IMAGE
  - packages/spec-core/src/anchors.ts#runAnchorQueries
  - packages/spec-core/src/anchors.ts#anchorHitQueries
  - packages/spec-core/src/anchors.ts#anchorHitExists
  - packages/spec-core/src/anchors.ts#anchorHitCommits
  - packages/spec-core/src/anchors.ts#resolveAnchor
  - packages/spec-core/src/anchors.ts#treeSitterExtractor
  - packages/spec-core/src/anchors.ts#treeSitterLanguage
  - packages/spec-core/src/anchors.ts#unitsAtFileRevision
  - packages/spec-core/src/anchors.ts#fileRevisionMemoKey
  - packages/spec-core/src/anchors.ts#hunksAt
  - packages/spec-core/src/anchors.ts#hunksAtMany
  - packages/spec-core/src/anchors.ts#hunkRecordsInto
  - packages/spec-core/src/anchors.ts#hunkMemoKey
  - packages/spec-core/src/anchors.ts#rememberHunks
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

The local candidate gate is deliberately **unmarked and ref-scoped**. At `reference-transaction`'s
`prepared` phase it reads every payload row and considers only `refs/heads/*` updates whose `new` object is
a commit. A `new` object already reachable from any ref or reflog is structural plumbing (`reset`, branch,
checkout, an already-landed rewrite) and the hook exits. Otherwise the object is a new local branch commit,
including an all-zero-old ref creation, and the hook runs `spex spec lint --pending <new>` before the ref
advances. Git exposes no operation name here, so the predicate never guesses from parent process command lines.
There is
no commit-msg arm, marker file, TTL, message/tree/parent binding, or message projection. Consequently
`--no-verify` cannot bypass the reference hook; the explicit local bypass is `SPEXCODE_SKIP_LINT=1`, named
verbatim in every rejection. The default fetch namespace (`refs/remotes/*`) is outside this ref-scoped gate;
an explicit fetch to `refs/heads/*` is intentionally judged like any other unreachable local ref update. Git
does not provide enough information at this boundary to preserve a fetch exemption while also judging every
replay operation, so this implementation chooses the ref-only, predictable option.
That same predicate applies in a bare receiver: the absence of a `.git` subdirectory is a storage layout, not
a structural-operation exemption.
One proven fast classification remains: a single-parent candidate diff containing only paths absent from every
candidate `code:` or `related:` declaration changes no governed subject or node metadata, so the hook's claim
scope check allows it before full lint; `.spec/.issues/*` is the zero-process common case for dashboard writes,
and the pre-commit hook performs the same Git-only classification before materialize/eval checks. The claim
set comes from the candidate specs, not `lint.governedRoots` (that setting controls source discovery and a
spec may explicitly govern a path outside it). Governance metadata (`.spec` nodes and config), any declared
source path, and every multi-parent candidate stay on the full candidate lint path; a merge may introduce
reachable side-branch debt even when its first-parent result tree only adds an issue file. If a ref update is
rejected, Git leaves the ref, index, sequencer state, and merge state untouched; the diagnostic names both the
continue and abort commands.
The candidate lint is scoped to the candidate's changed paths and their governing nodes. It uses the same Git-derived
history facts, rename projection, hunk/range intersection and ancestry filtering as the full verdict; changed paths
narrow which nodes are judged, never which reachable events exist. Full `spex spec lint` keeps the complete graph
and history verdict for CI and dashboards. The narrow verdict is equivalent to full lint for every governed node
touched by the candidate; unrelated pre-existing debt is not re-litigated by a plumbing commit. Exact verdict reads
may grow with reachable history because the event set and rename projection are part of the semantics; no persistent
cache or depth-independent read is part of this contract.

For a pending merge, changed-path scope is the union of diffs against every parent. An `ours` merge may leave
the result tree equal to its first parent while making a side-branch commit reachable; that newly reachable debt
remains in the candidate anchor window and cannot be washed by a merge trailer.

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

The board's cold/full build must remain materially below the graph stream's patrol interval. Patrol is a
last-resort self-healing invalidation; when a build outlives that interval, patrol can invalidate the still
running build and amplify latency indefinitely. The index cost therefore protects both commit acceptance and
dashboard liveness; changing the patrol period alone only moves the threshold.

The candidate lint run also owns one deliberately asymmetric **governor-transition integrity** check,
separate from anchor drift: when the candidate deletes a spec node, its old `HEAD` blob supplies that
node's former `code:` claims, and the candidate must either delete each governed subject or transfer it to
a real node in the same tree. `Spec-OK` cannot waive removal of the governor itself. After such a commit is
already `HEAD`, the deleted claim is no longer present to reconstruct this transition; ordinary HEAD lint
therefore has only the current-tree coverage warning. “The same predicate at two tips” below describes the
anchor-drift predicate, not this transition guard.

`Spec-OK` remains node-scoped acknowledgement metadata for full lint. A trailer on a content-bearing commit
acknowledges that commit only; a tree-identical one-parent `spex spec ack` checkpoints reachable ancestors.
The candidate gate does not use trailers as identity or as an arming signal, so scissors cleanup and every
other Git message path are judged from the immutable commit object itself.

Git's default merge diff had additionally hidden both merge-authored anchor movement and merge-authored spec
versions; cc makes these writes visible without re-billing ordinary branch content transported by the
project's normal `--no-ff` merges. A candidate that owes several touched nodes emits one node-scoped error
per debt, naming every node the author must answer. This is an honesty property of ref updates that reach the
installed hook, not a claim that an uncovered hook or explicit `SPEXCODE_SKIP_LINT=1` can be made impossible.

The cost is intentional and stated plainly: local acceptance is **strictly narrower** than CI acceptance.
For example, code-only `P1` followed by spec-only `P2` is green when CI judges the final branch tip, but
local authoring rejects `P1`; code and governing spec must land atomically, removing cross-commit iteration.
This is an honesty property of commit paths that reach the installed, non-bypassed candidate gate, not a
claim that Git makes lies or bypasses physically impossible: a meaningless spec byte edit can mechanically
move the version, and an uncovered hook path or explicit bypass can still land first and acknowledge later.

**Extraction is a language seam.** Extractors are pure `(content, filename) → units` functions (no
git, no cache, no fs — importable by an external scorer as-is), and every extension maps to exactly
ONE designated extractor — no cross-language or cross-engine fallback. The precise extractor for every
shipped language is the same Tree-sitter WASM engine; a language is a DATA row carrying its grammar,
extension set, declaration-node rules, qualified-name rules, and extractor schema. The initial rows are
TypeScript/TSX, Python, Go, Rust, Java, and Ruby. Adding a language adds a row and grammar asset, never a
new resolver branch. The runtime and grammar assets are SpexCode package inputs, so adopters do not need
the language's compiler or a host parser dependency. The runtime is initialized lazily; an unavailable
runtime, missing grammar, incompatible grammar ABI, or parse error is an explicit `integrity` error and
leaves the affected anchors unverified rather than silently selecting another parser or returning a fake
pass. Tree-sitter's error-recovery tree is therefore rejected when its root reports `hasError`.

That strictness has a cost the rejection message must carry: a shipped grammar can lag its language, so a
file rejected here is not necessarily invalid source. The pinned TypeScript grammar, for one, parses
`import('mod').Type` but not the array over it, `import('mod').Type[]`. And because a rejection is
file-wide while a session's scope spans many nodes, ONE such file makes every selector into it
unextractable and, through [[session-eval]]'s explicit-unavailable rule, takes down every session's eval
summary at once — the loudest possible failure wearing the quietest possible face, a toolbar that reads
"unavailable" and names no cause. So the message names the file and the engine's verdict, and the honest
remedies are the grammar row and the source construct, never a softened gate: a parse this engine cannot
certify may not be reported as a hit or a no-hit.

The place to meet that cost is the ref-change gate, at the moment the construct is written, and the
population it must cover is EVERY declared selector. A selector's declaration site — a node's frontmatter
or a scenario's `code:` in an eval.md — decides who repairs it, never whether it is checked: both write
`path#unit` and both arrive here. [[spec-lint]] owns that gate and refuses an unresolvable selector from
either site as one integrity error. A file no node anchors but many scenarios do was, before that, a file
this engine parsed constantly and no gate ever asked about.

The extractor contract stays language-agnostic above the seam: immutable file-revision memoization,
dead/ambiguous resolution, and hunk∩range all live outside it. A memo key includes every input to the
extractor: object-hash algorithm and blob oid, filename semantics (including script kind), extractor/schema
identity, grammar/runtime identity, and normalized query configuration; same bytes under `.ts` and `.tsx`
therefore never share a result by oid alone, and the result is independent of call order. Within one READ
— a lint run, a board build, a CLI scan — every live anchored window is handed to the engine at once: it
reads a historical `(commit,path)` image, its blob, and an ordinary `(commit,path)` hunk once, then applies
each node's own selector set and emits findings in declaration order.

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
narrowed to one node or one reading would re-fork the batch per unit — the same inversion the READ-is-the-unit
rule below forbids. Enumeration takes its remaining window in a single slice and so keeps the one-round shape
it has always had. Measured on the reference corpus, the two questions differ by 1,158 parsed file revisions
(52.6 MB) versus 307 (21.9 MB) for the same 858 booleans.

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

The Tree-sitter rows preserve one shared declaration vocabulary. TypeScript/TSX expose top-level functions,
classes and class methods, simple variable declarations, enums, interfaces, and type aliases; Python
exposes `def`, `async def`, and classes with lexical qualification; Go exposes constants, types, functions,
and receiver methods (`Command.SetArgs`); Rust exposes constants, structs, enums, traits, functions, and
impl methods (`Command.set_args`); Java exposes classes, final fields, constructors as `Class.constructor`,
and methods (so overloads remain ambiguous); and Ruby exposes constants, methods, singleton methods,
classes, and modules with enclosing class/module qualification. Decorators and declaration ranges come from
the syntax nodes. Dynamic
callables, imported aliases, macro-generated declarations, and runtime-attached methods remain outside the
capability. Unsupported names fail as dead anchors, and duplicate qualified declarations stay ambiguous
through the same language-agnostic resolver used by every extractor.
