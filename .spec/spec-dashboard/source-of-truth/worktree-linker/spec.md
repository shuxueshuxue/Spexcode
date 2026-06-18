---
title: worktree-linker
status: merged
session: sess-design
hue: 190
desc: Map each worktree to its node via branch name + an untracked .session file.
code:
  - spec-cli/src/layout.ts
---
# worktree-linker

Branch `node/<id>` names the node (self-describing). An untracked `.session` file
carries the live session id/status. The linker = `git worktree list` -> parse
branch -> diff vs main -> overlay. Composable: `.spec` stays in-tree.
