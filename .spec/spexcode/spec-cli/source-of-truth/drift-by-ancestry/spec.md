---
title: drift-by-ancestry
status: pending
hue: 35
desc: Drift must be judged by true git ancestry (a governed commit counts iff it is NOT an ancestor of the spec's version), never by a commit-date-ordered linear position — which silently under-reports whenever history isn't chronological.
---
# drift-by-ancestry

## raw source

Drift asks one question: has the governed code moved **ahead of** the spec's latest version? The
honest answer is an **ancestry** question, not a timing one — a governed commit is drift exactly when
it is **not an ancestor** of the node's version commit (it lies in `version..HEAD`). The same ancestry
basis governs the two neighbours of the count: the *base* it measures from (the node's ancestry-latest
version, not the date-newest) and the acknowledgement *floor* (a `Spec-OK` ack quiets the commits
reachable from the ack commit). This is what [[spec-node-states]] already promises when it says drift
is measured "by git ancestry"; this node holds that promise as the contract so the code can be made to
honour it.

## expanded spec

The reason this node is written before it is built: today the [[source-of-truth]] derivation
**approximates** ancestry with a one-dimensional position — each commit is numbered by its place in a
default `git log` walk (roughly commit-date order) and "newer than the spec" is decided by comparing
those numbers. A single line cannot encode a branching history's partial order, so the approximation
**silently under-reports** whenever the timeline isn't chronological: a spec commit stamped *today*
merged alongside older-dated commits that are in fact its DAG descendants (back-extraction, merging a
long-lived or old branch, rebases, subtree/vendor imports, clock skew) reads those real changes as
"older than the spec" and drops them. The board goes green while the truth is not green — and the
failure lands hardest on **adoption**, where a whole spec tree is back-extracted onto an existing
history and the under-report is near-total.

Two things make this fixable rather than fundamental. First, no linear order rescues it — **date or
topological**, a total order still can't express "these two commits are on parallel branches," so the
remedy has to be real reachability (walk the DAG, or use commit-graph generation numbers as a prefilter
over an exact check), not a better sort. Second, the correct primitive **already lives in the repo**:
session review counts "commits ahead" with `rev-list base..HEAD` ancestry (see [[sessions]]), so drift
is the one derivation still using time where its siblings use ancestry.

The deferred work is the **algorithm**, not the intent: enrich the single history walk with parent
edges so reachability stays an in-memory lookup (no per-node git subprocess — [[source-of-truth]]'s
"scale with history, not node count" still holds), extend it to the ack floor and the version base, and
land it with a re-baseline pass since correcting the under-report will legitimately flip some green
nodes to drift. Until then this gap is a known blind spot in the [[spec-lint]] drift warning.
