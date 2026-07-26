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
upper bound.

The information lower bound is concrete. Let one branch contain an anchored hit `h` followed by version
`vB`, let its sibling contain version `vA`, and merge them without authoring a new spec line. Both parent
verdicts are clear, but if the full-history walk selects `vA`, `h` is not reachable from that version and
becomes debt at the merge. Parent states `(vA, empty)` and `(vB, empty)` are identical to a history where
`h` never hit, so no join over only `(v, D)` can recover the correct answer. The exact representation must
retain `h` (or equivalent growing information) until read-time filtering; a later merge-authored spec
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
nodes, 160 rename events form chains of at most 4 (mean 1.51), while retained historical anchor hits grow
from 198 at depth 1,002 to 458 at 2,497, 748 at 4,200 and 749 at the tip. The reference proof projects the
intended version base for all 217 nodes and compares normalized drift sets at 14 pinned tips. These
measurements justify keeping the exact event/projection architecture and reducing its constants; they do
not turn its asymptotic lower bound into a constant.

The local errors-block gate is one narrowly-armed two-hook transaction. `commit-msg` is the arming point:
it proves this is a commit path Git actually sends through the gate and records the candidate's current
HEAD + index tree in that worktree's private git-dir. Git then creates the real commit object. At
`reference-transaction` **prepared**, before its ref advances, the hook consumes that one arm only when the
transaction's old oid and the real commit's tree match it, then runs ordinary lint with the real new oid as
the explicit pending tip. Thus ordinary commit, amend, squash and merge are judged with their actual final
message/tree/parents — no synthetic `commit-tree` parent guess. A failed signing or aborted commit leaves at
most one stale arm: the next `prepare-commit-msg` clears it, and head/tree/age checks prevent an unrelated
ref update from consuming it. The arm lives in the per-worktree git-dir, so linked worktrees cannot collide.

Information availability is not hook coverage. `commit-msg` is skipped by cherry-pick/rebase on supported
Git, by `--no-verify`, and in a clone with no installed hook; those paths create no arm, remain at today's
local coverage, and [[ci-gate]] judges their landed `HEAD`. The reference hook does no Git walk or lint at
all without a matching arm, so reset/checkout/branch/tag/fetch and programmatic `--no-verify` data commits
are unchanged. Canonical pre-commit defers anchor errors only when both canonical arm/consume hooks are
actually installed; if `spex init` preserves either user hook, pre-commit retains the old HEAD gate, so a
hook collision never reduces local coverage. `SPEXCODE_SKIP_LINT=1` remains the explicit local bypass.

The candidate lint run also owns one deliberately asymmetric **governor-transition integrity** check,
separate from anchor drift: when the candidate deletes a spec node, its old `HEAD` blob supplies that
node's former `code:` claims, and the candidate must either delete each governed subject or transfer it to
a real node in the same tree. `Spec-OK` cannot waive removal of the governor itself. After such a commit is
already `HEAD`, the deleted claim is no longer present to reconstruct this transition; ordinary HEAD lint
therefore has only the current-tree coverage warning. “The same predicate at two tips” below describes the
anchor-drift predicate, not this transition guard.

This **reverses** the earlier recorded choice to have no separate candidate-tree gate. That choice was
sound under the capability available then: `Spec-OK` could only be a later `--allow-empty` stamp, so a
content-bearing implementation commit had no honest in-commit acknowledgement route and a staged gate
would create an unconditional rejection. Git's native `git commit --trailer "Spec-OK: <node>"` now makes
that route real. A trailer on a content-bearing commit acknowledges **that commit only**; it does not
checkpoint older debt. A reachability checkpoint must have exactly one parent and the same tree as that
sole parent. This keeps the tree-unchanged `spex spec ack` stamp as the checkpoint that covers ancestors,
but makes every merge self-only: even an `ours` merge with an unchanged first-parent tree introduces new
reachable history. Changing the node's `spec.md` in the candidate instead makes that
candidate the latest version, closing its window by construction. Without either route, an anchored
intersection is rejected before attribution can slide to a successor commit.

The partition also repairs two silent losses in the earlier read side. Treating every trailer commit as a
reachability checkpoint let a content self-declaration for one node pardon older debt, including debt of
another node; treating tree equality alone as emptiness let an `ours` merge checkpoint unanswered commits
from its newly reachable side branch. Neither is an acceptable acknowledgement. Candidate and later HEAD
lint now classify the immutable commit object the same way and retain each node's independent debt. When a
candidate owes several nodes, lint emits one node-scoped error per debt, naming every node the author must
answer without combining their acknowledgement sets. Git's default merge diff had additionally hidden
both merge-authored anchor movement and merge-authored spec versions; cc makes those writes visible without
re-billing ordinary branch content transported by the project's normal `--no-ff` merges.

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
