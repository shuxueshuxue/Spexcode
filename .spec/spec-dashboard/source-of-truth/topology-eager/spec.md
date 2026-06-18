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

Two kinds of change. Topology (create / reparent) must commit to `main` eagerly
so children are visible and child worktrees can be seeded. Content (a node's spec
body) can live as a long-running worktree diff until merged.
