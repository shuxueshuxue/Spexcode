---
title: drift-by-ancestry
status: active
hue: 35
desc: Drift is judged by true git ancestry — a governed commit counts iff it is NOT reachable from the spec's version — never by a commit-date-ordered linear position, which silently under-reports on branchy history.
code:
  - spec-cli/src/git.ts
related:
  - spec-yatsu/src/freshness.ts
---
# drift-by-ancestry

## raw source

Drift asks one question: has the governed code moved **ahead of** the spec's latest version? The
honest answer is an **ancestry** question, not a timing one — a governed commit is drift exactly when
it is **not an ancestor** of the node's version commit (it lies in `version..HEAD`). The same basis
governs the acknowledgement floor: a `Spec-OK` ack quiets exactly the commits reachable from the ack
commit, never a sibling branch's changes. This holds the promise [[spec-node-states]] makes when it
says drift is measured "by git ancestry".

## expanded spec

No linear order can keep that promise — date or topological, a total order cannot express "these two
commits sit on parallel branches", so any position compare silently under-reports whenever history
isn't chronological: back-dated or long-lived branches merged in, cherry-picks, and hardest of all
**adoption**, where a spec tree is back-extracted onto an existing history. The [[source-of-truth]]
walk therefore carries the DAG itself: the one cached `git log HEAD` is enriched with each commit's
parent edges, and "newer than the spec" is answered by in-memory reachability (memoized per queried
sha as a bitset over the walk) — the exact equivalent of `git rev-list version..HEAD -- <file>`, with
no per-query git fork, so "scale with history, not node count" still holds. The same one rule feeds
every consumer of the signal — the [[spec-lint]] drift warning, the board's drift counts, and yatsu's
code/scenario freshness axes ([[yatsu-core]]) — with no parallel heuristic beside it.

A sha the walk never met — not reachable from HEAD — keeps a conservative rule on the drift side:
drift measured *from* it reads 0 (no basis on HEAD to measure from). A reading stamped *with* it no
longer folds into a blanket stale: where ancestry can't testify, yatsu falls back to comparing
CONTENT between the anchor's tree and HEAD ([[yatsu-core]]'s content fallback) — a fold, rebase,
squash-merge or cherry-pick that left governed content byte-identical reads fresh, and only an
anchor whose commit object is truly gone stays conservatively stale (named as such). Distinguishing
a genuine orphan from a reachable-but-unmerged branch is still never attempted — the content compare
is honest for both without ref-scanning beyond the one HEAD walk. The fallback keeps the walk's cost
promise too: its git lookups are memoized over immutable objects — a full sha names a fixed tree
forever, so a (sha, path) resolution never invalidates — and a rebuild over a fully-orphaned corpus
(an adopter history rewrite) pays in-memory lookups, scaling with distinct anchors, never with
readings × rebuilds. Among *parallel* version commits
of one node (two branches each re-versioning it), the base stays the walk-newest row — an ambiguity
only a merge resolves.

Correcting the under-report legitimately surfaces previously-hidden drift on existing boards — a
re-baseline, not a regression.
