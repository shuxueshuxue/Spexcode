---
title: topology-eager
status: merged
session: sess-design
hue: 175
desc: Topology changes commit to main eagerly; node content lives long in worktrees.
code:
  - scripts/seed-spec-history.sh
---
# topology-eager

## raw source

Two kinds of change. **Topology** (create / reparent) must commit to `main` eagerly so children are
visible and child worktrees can be seeded. **Content** (a node's spec body) can live as a long-running
worktree diff until merged. The two have different urgencies, so they have different commit cadences.

## expanded spec

Topology is structural: it changes which nodes exist and where they sit in the tree (the parent edge,
derived from the directory layout). A child can't be seeded into its own worktree until its directory
exists on main, so topology can't wait in a long-lived diff — it commits to main eagerly (the
`SPEXCODE_ALLOW_MAIN` escape hatch from [[main-guard]] exists precisely for these seeding/topology
commits). Content is the spec body; it carries the session's in-flight intent and is fine to sit as a
worktree diff until reviewed and merged, which is the normal dogfood ritual.

The clearest expression of "topology committed eagerly to main" is `scripts/seed-spec-history.sh`: it
replays the project's real design conversation as the git history of the `.spec` tree, one commit per
spec change (subject = the reason, `Session:` trailer = attribution), so each node's version history is
just `git log` of its `spec.md`. It is one-shot — it refuses to run if the tree already exists.

## current state

### description

`scripts/seed-spec-history.sh` is the eager-topology seeder. Its `seed()` helper writes a `spec.md`,
`git add`s it, and commits with a backdated `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, a reason subject,
and a `Session:` trailer — so the seeded commits read exactly like real spec versions to the
[[source-of-truth]] aggregator. It lays down the `spexcode` project root and its package/children
(including reparenting `source-of-truth` under `spec-cli` and absorbing the hour-0 seed), guarded by an
existence check on a known node so a re-run aborts cleanly. The live mechanism that keeps topology eager
day-to-day is the [[main-guard]] escape hatch (`SPEXCODE_ALLOW_MAIN=1`) for create/reparent commits;
the seeder is the historical bootstrap of that same policy.

### verdict — not drifted

`seed-spec-history.sh` is the only governed file and sits at this node's latest version with no commits
ahead (`spex lint` reports no `drift` warning for `topology-eager`). The script last changed when the
real `spexcode` root was introduced and `source-of-truth` was reparented under `spec-cli`; the expanded
spec frames the script as "replay topology eagerly onto main" and the description records that the seed
now plants that exact tree shape — a factual update, not a code detail back-written to pad the spec. The
raw source (topology eager to main, content long-lived in worktrees) still holds.
