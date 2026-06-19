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
