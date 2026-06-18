---
title: source-of-truth
status: merged
session: sess-design
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
code:
  - spec-cli/src/specs.ts
  - spec-cli/src/git.ts
  - spec-cli/src/index.ts
---
# source-of-truth

The canonical spec state is `.spec` on `main`. A worktree's `.spec` is never a
rival truth — it is a pending proposal, attributed to a session. On merge it
becomes the new version plus one entry in that node's history. The dashboard is a
read-time aggregator over git, not a separate store.
