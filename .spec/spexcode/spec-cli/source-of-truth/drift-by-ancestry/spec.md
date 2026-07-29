---
title: drift-by-ancestry
status: active
hue: 35
desc: Drift is judged by true git ancestry — a governed commit counts iff it is NOT reachable from the spec's version — never by a commit-date-ordered linear position, which silently under-reports on branchy history.
code:
  - spec-cli/src/git.ts#driftFor
  - spec-cli/src/git.ts#ackCoverFor
related:
  - spec-eval/src/freshness.ts
---
# drift-by-ancestry

## raw source

Drift asks one question: has the governed code moved **ahead of** the spec's latest version? The
honest answer is an **ancestry** question, not a timing one — a governed commit is drift exactly when
it is **not an ancestor** of the node's version commit (it lies in `version..tip`, normally
`version..HEAD`). The same basis
governs the acknowledgement floor: a `Spec-OK` ack quiets exactly the commits reachable from the ack
commit, never a sibling branch's changes. This holds the promise [[spec-node-states]] makes when it
says drift is measured "by git ancestry".

## expanded spec
No linear order can keep that promise — date or topological, a total order cannot express "these two commits sit
on parallel branches", so any position compare silently under-reports whenever history is not chronological:
back-dated or long-lived branches merged in, cherry-picks, and hardest of all adoption. The walk therefore
preserves the DAG question itself: ordinary reports read one Git-derived event fold,
project historical path identities through the current tip, and apply in-memory reachability. A path-scoped
`rev-list` is not an alternate representation: even `--full-history` can miss pre-rename events, while `--follow`
cannot model path reuse or parallel rename forks. The one event/project/filter mode avoids a per-node history
walk, so "scale with history, not node count" remains a correctness shape, not a performance promise. The same
rule feeds every consumer of the signal — the [[spec-lint]] drift warning, board drift counts, and eval engine's
code/scenario freshness axes ([[eval-core]]) — with no parallel heuristic beside it.

The exact implementation is an event fold followed by a read-time project/filter. The ordinary drift fold reads
one NUL-framed Git raw-identity event per commit: a status and one path, or the two endpoints of a rename, with
old/new blob ids fixed by `--raw -z --no-abbrev -M -l0 --no-ext-diff --no-textconv`. Drift projects paths only;
the same immutable OID pairs decide `.spec` content versions, so attributes cannot reinterpret a
version window. Merge-owned lines remain the separate combined merge stream. The project step maps historical paths
through the current tip's rename topology before applying the walk-newest version and ancestry filters. This split is part of the
contract: a path-only fold cannot preserve renamed-node identity, and a fold that permanently erases a hit cannot
reconstruct it when incomparable version branches are joined. Preserving this semantics admits no design with both
bounded state and an O(1) read: the rename-chain and parallel-version counterexamples move the required work either
to write time or to read time. This is a cost bound, not permission to change drift meaning.

The reference corpus measurements and the independent baseline CLI remain proof evidence for semantic behavior,
not a claim that the current one-shot CLI has a lower wall-clock slope. Any future optimization must first prove a
positive control, then compare a separate implementation against this Git-derived path at pinned tips.
A sha the walk never met — not reachable from HEAD — keeps a conservative rule on the drift side: drift measured
*from* it reads 0 (no basis on HEAD to measure from). A reading stamped *with* it no
longer folds into a blanket stale: where ancestry can't testify, eval freshness falls back to comparing
CONTENT between the anchor's tree and HEAD ([[eval-core]]'s content fallback) — a fold, rebase,
squash-merge or cherry-pick that left governed content byte-identical reads fresh, and only an
anchor whose commit object is truly gone stays conservatively stale (named as such). Distinguishing
a genuine orphan from a reachable-but-unmerged branch is still never attempted — the content compare
is honest for both without ref-scanning beyond the one HEAD walk. The fallback keeps the walk's cost
promise too: its git lookups are memoized over immutable objects — a full sha names a fixed tree
forever, so a (sha, path) resolution never invalidates — and a rebuild over a fully-orphaned corpus
(an adopter history rewrite) pays in-memory lookups, scaling with distinct anchors, never with
readings × rebuilds. That promise binds every such memo's bound: sized above the largest adopter
reading corpus — one entry per (reading, path) worst case — since a bound below the corpus's
distinct keys turns the fixed-order rebuild into whole-memo eviction thrash, memoized in name but
forking every pass. Among *parallel* version commits
of one node (two branches each re-versioning it), the base stays the walk-newest row — an ambiguity
only a merge resolves.

The local [[code-anchor]] gate asks this same walk about one explicit candidate commit. Every build
parameterizes the event projection and ancestry range by that tip. Ordinary commits use their normal path diff;
merges enter a governed path window only through dense combined (`--cc`) **lines** whose prefix differs
from every parent column. Mixed-prefix lines inherited from any parent stay outside even when adjacent to
an all-parent line in one hunk; all-parent deletions retain one preimage range per parent. This line-level map also
decides whether a merge created a spec version. Thus clean transport stays neutral while content authored
during conflict resolution retains the merge's identity and responsibility. Candidate builds are transient and
shared only inside one lint call, so a rejected dangling oid cannot evict or contaminate a HEAD result.

Correcting the under-report legitimately surfaces previously-hidden drift on existing boards — a
re-baseline, not a regression.

`eventsSince(idx, sha, path)` is where that rule lives, once: the commits touching `path` that are NOT
ancestors of `sha`, i.e. the ones in `sha..HEAD` by true DAG reachability. `null` is its honest third answer —
the anchor commit is unreachable (folded, rebased, cherry-picked away), so ancestry cannot testify at all and
the caller must say what it does about that. Each layer decorates the same window with what is genuinely its
own: the spec layer subtracts ack cover (an ack is spec-only and never a reading-freshness rule), and the eval
layer falls back to comparing content when the window is `null`. What no caller may do is restate the
reachability rule itself — retyping it is how it came to exist four times (`driftPathWindow` here, plus
`changedSince`, the code window, and `codeDrift` in the eval layer), each with its own null handling to get
subtly wrong.
