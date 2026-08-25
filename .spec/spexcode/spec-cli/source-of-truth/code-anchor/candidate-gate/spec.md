---
title: candidate-gate
status: active
hue: 15
desc: The local commit gate is ref-scoped and unmarked: the reference-transaction hook lints a pending commit before its ref advances, judging only the candidate's changed paths and their governing nodes, with `SPEXCODE_SKIP_LINT=1` as the one named bypass.
code:
  - spec-cli/templates/hooks/reference-transaction
related:
  - spec-cli/templates/hooks/commit-msg
  - spec-cli/src/lint.ts
  - spec-cli/src/commit-gate.test.ts
  - spec-cli/src/lint-scoped.test.ts
  - spec-cli/templates/hooks/pre-commit
---

# candidate-gate

[[code-anchor]] decides whether a commit touched an anchored unit; this node decides WHEN that question is asked
locally — at the ref update, on the immutable candidate object — and what the answer may and may not waive.
[[spec-lint]] owns the verdict's rules; [[main-guard]] shares the pre-commit file with a different concern.

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
