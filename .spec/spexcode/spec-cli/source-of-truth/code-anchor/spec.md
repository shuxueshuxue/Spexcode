---
title: code-anchor
status: active
hue: 15
desc: A code: entry may pin named units (`path#symbol` selectors, any number, one base file, OR'd); drift touching any pinned unit is the BLOCKING tier (one anchor-drift error naming hit selectors), replacing the retired count-based driftErrorThreshold gate. related: selectors warn on hit, stay silent on miss. Anchors are optional — an unanchored node never blocks.
code:
  - spec-cli/src/anchors.ts#anchorHitCommits
  - spec-cli/src/anchors.ts#resolveAnchor
related:
  - scripts/anchor-drift-golden-proof.mjs
  - scripts/anchor-drift-fold-proof.mjs
  - spec-cli/src/lint.ts
  - spec-cli/src/git.ts
  - spec-cli/src/git.test.ts
  - spec-cli/src/specs.ts
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

**Judgment.** The window is the spec's last version → the tip being judged: `HEAD` for an ordinary
report/CI run, and a pending commit for a locally-authored candidate. It is the same ack-filtered set
[[drift-by-ancestry]]'s walk already derives. Per ordinary window commit, the file's
`--unified=0` hunks are intersected with the unit's line range extracted from the file **as it existed
at that commit** — never from the later working tree, so renames/moves and partial staging attribute
correctly. A merge contributes only individual result lines in its dense combined (`--cc`) diff that are
different from **every** parent: an all-`+` prefix is an authored result line and an all-`-` prefix is an
authored deletion point. A mixed prefix such as `+ ` is inherited from at least one parent and stays out,
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
while its current node is not: ordinary rename preserves lineage, path reuse starts a new lineage, and
parallel renames may fork one lineage into several current paths. A clean merge can own zero all-parent
lines yet make arbitrarily many side-branch keys reachable. Materializing those keys charges the write;
keeping only parent pointers charges the later read. The walk does not disappear, it moves. The exact,
no-semantic-change route is therefore an incrementally maintainable event index plus read-time rename
projection and reachability/ack filtering; it may reduce repeated reconstruction, but it cannot promise
bounded state or history-independent `O(1)` verdict reads.

The worst-case bounds are real but loose on the reference history. Across 4,266 commits and 217 current
nodes, 160 rename events form chains of at most 4 (mean 1.51), while anchor-hit identities derived from the
complete drift event index grow from 202 at depth 1,002 to 466 at 2,497, 756 at 4,200 and 757 at the tip.
The smaller 198 / 458 / 748 / 749 series was an instrumentation undercount: a path-limited
`rev-list --no-merges <tip> -- <current-path>` simplified away eight real single-parent hit events
(indexed-only 8, simplified-only 0). The reference proof projects the intended version base for all 217
nodes and compares normalized drift sets at 14 pinned tips. These measurements justify keeping the exact
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
rejected, Git leaves the ref, index,
sequencer state, and merge state untouched; the diagnostic names both the continue and abort commands.

The candidate lint is scoped to the candidate's changed paths and their governing nodes. It uses short,
path-limited history queries for those paths, so its Git work scales with the number of changed files and the
new commits in those windows, not with repository age. Full `spex spec lint` keeps the complete graph and
history verdict for CI and dashboards. The narrow verdict is equivalent to full lint for every governed node
touched by the candidate; unrelated pre-existing debt is not re-litigated by a plumbing commit. The performance
target is therefore growth with newly added events rather than a fresh walk of all historical commits. A
strictly depth-independent read is not an attainable requirement here: the event set itself grows, and the
cost-conservation bound moves the required ancestry work between indexing and projection. The measured
perfrepo result (6.3x to 3.7x CPU growth across the reported depths) is recorded as the achieved slope change,
not as a promise of constant-time reads.

Four immutable event streams are persisted by commit oid in the project's one global runtime root
(`~/.spexcode/projects/<enc(project-root)>/history-events-v4-<state>.ndjson`) and extended only for previously unseen
commits: `.spec` numstat/rename events, merge-authored combined-diff paths, `Spec-OK` trailer declarations,
and `.spec` name events. The schema/state key includes the cache implementation schema, shallow/graft state,
and every `refs/replace/*` target, so an upgrade or Git-object interpretation change selects a new ledger
instead of silently reading an old format. Each event is a property of its commit object and never changes.
Every complete ledger ends in an integrity row containing the byte length and SHA-256 digest of all preceding
event and tip rows. Readers accept only an exact match; a missing footer, truncation, or syntactically usable
remainder with one damaged row discards the whole cache and rebuilds it from immutable Git objects. Writers take
a cross-process lock and replace a complete payload-plus-footer temporary file in one rename; event rows and a tip
marker therefore become visible together, and a killed writer leaves only an ignored temporary file. For every
tip, `ls-tree`, parent reachability, and the canonical rename projection are recomputed from cached events, so
current paths and node ownership cannot become stale. A cold checkout pays one full walk to seed the cache;
later processes append only the commits since cached tips. The projection is in-memory and bounded by the
current tip, while the event ledger grows only with new commits. The root identity is the same `runtimeRoot`
used by sessions, materialize slots, backends, and uninstall; one repository never acquires a second opaque
top-level cache identity, and the public uninstall removes the ledger with the rest of that project's runtime.

For a pending merge, changed-path scope is the union of diffs against every parent. An `ours` merge may leave
the result tree equal to its first parent while making a side-branch commit reachable; that newly reachable
debt remains in the candidate anchor window and cannot be washed by a merge trailer.

A benchmark is not an oracle until a positive control proves that it can fail. Before accepting an
equivalence run, execute one pinned case with known anchor debt and require the normalized set to contain
that debt; only then compare candidate and baseline. Capture every channel that carries findings on every
exit status. In particular, warning-only lint exits zero while writing findings to stderr, so a harness that
reads stderr only on failure turns real debt into an empty set and makes two broken measurements look equal.
The same rule excludes a fake CLI or receiver from standing in for the product surface being proved. This is
a measurement invariant: a harness that does not prove it can observe a known failure may report agreement
while both the product and the oracle are silently truncated or replaced by a fake dependency.

**Oracle invariant.** `historyIndexFull` and `driftIndexFull` are the deliberately slow, uncached full-history
implementations kept in the repository as the correctness oracle. The default `historyIndex` and `driftIndex`
must produce the same downstream verdicts as those oracles at every tip; the suite's oracle comparison is a
standing regression test for every future index optimization. The known benefit is a changed growth law, not
a promised wall-clock target: the four history scans become incremental, while process startup, bounded tip
walks, file reads, parsing, and other object lookups remain part of the measured absolute cost.

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
ONE designated extractor — no cross-language or cross-engine fallback. The JS family's designated
extractor is `ts-ast`, backed by the governed repository's own TypeScript module so its parse matches the
project's compiler. TypeScript is an OPTIONAL host capability, not SpexCode runtime cargo: repositories
that use JS anchors normally already carry it, while Python and unanchored-JS adopters do not pay for a
compiler they never invoke. The host candidate is probed through the actual parse API, not mere
resolvability; an incompatible API is an error rather than a silent switch to another parser version.
When the governed repository provides no usable TypeScript, lint emits an explicit `integrity` error (with a
diagnostic naming the extractor and repair), skips JS-family anchor extraction, and continues the
remaining checks; the non-zero result is a non-verification signal (never a silent or falsely passing
anchor result), and the process does not throw. Other languages arrive as DATA rows to a generic engine (the heuristic
declaration/boundary patterns today; a row may carry whatever config its engine needs — e.g. a
tree-sitter grammar — so adding a language never adds a branch). Everything language-agnostic — immutable
file-revision memoization, dead/ambiguous resolution, hunk∩range — lives outside the seam. A memo key
includes every input to the pure extractor: object-hash algorithm and blob oid, filename semantics
(including script kind), extractor/schema identity, host parser identity, and normalized parser configuration;
same bytes under `.ts` and `.tsx` therefore never share a result by oid alone, and the result is independent
of call order. Git access stays
batch/short-lived; no resident process.

Python is one such data row, designated for `.py` and `.pyi`. Its structural vocabulary is ordinary
`def`, `async def`, and `class` declarations: module functions keep their bare name, while methods and
nested declarations use their lexical qualified name (`Class.method`, `outer.inner`,
`Outer.Inner.method`). Significant indentation supplies scope and unit boundaries, including decorator
lines immediately attached to a declaration. This is deliberately a declaration extractor, not a
Python runtime or full grammar: lambdas and callables assigned or attached dynamically, imported aliases,
generated names, and declarations whose name is not on the first physical header line are outside the
capability. Unsupported names fail as dead anchors, and duplicate qualified declarations stay ambiguous
through the same language-agnostic resolver used by every extractor.
