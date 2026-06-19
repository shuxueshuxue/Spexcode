---
title: worktree-linker
status: merged
session: sess-design
hue: 190
desc: Map each worktree to its node via branch name + an untracked .session file.
---
# worktree-linker

## raw source

Branch `node/<id>` names the node (self-describing). An untracked `.session` file carries the live
session id/status. The linker = `git worktree list` → parse branch → diff vs main → overlay.
Composable: `.spec` stays in-tree, so adopting SpexCode needs no restructure.

## expanded spec

Two independent facts identify a worktree's work. The **branch** (`node/<id>`) names *which* node it
proposes changes to — self-describing, so the mapping needs no registry. The untracked **`.session`**
file carries the *live runtime* facts that must not be committed: the node id (a fallback / override
when `nodeFrom: 'session'`), the session id, and the status. The linker reads both, then diffs the
worktree's `.spec` against main to produce the per-node overlay (`ops`) the board renders.

This lives inside the [[portable-layout]] seam (`layout.ts`): the linker is the half that, given the
enumerated worktrees, attaches node id + session + status + overlay to each. Keeping `.session`
untracked is what lets the same `.spec` tree stay in-tree and canonical on main while a worktree layers
ephemeral, session-scoped state on top without polluting history.
