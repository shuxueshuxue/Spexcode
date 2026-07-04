---
title: drift-by-ancestry
status: active
hue: 35
desc: Drift is judged by true git ancestry — a governed commit counts iff it is NOT reachable from the spec's version — never by a commit-date-ordered linear position, which silently under-reports on branchy history.
code:
  - spec-cli/src/git.ts
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

A sha the walk never met — not reachable from HEAD — gets a single conservative rule: drift measured
*from* it reads 0 (no basis on HEAD to measure from), and a reading stamped *with* it reads stale
(freshness can't be proven). That rule deliberately folds two different cases — a genuine orphan
(rebased away, never on any ref) and a commit on a reachable-but-unmerged branch that will land later;
distinguishing them would need ref-scanning beyond the one HEAD walk for marginal value, and the
conservative reading is honest for both. Among *parallel* version commits of one node (two branches
each re-versioning it), the base stays the walk-newest row — an ambiguity only a merge resolves.

Correcting the under-report legitimately surfaces previously-hidden drift on existing boards — a
re-baseline, not a regression.
