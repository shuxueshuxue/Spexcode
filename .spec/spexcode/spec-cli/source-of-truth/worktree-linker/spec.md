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

## current state

### description

In `layout.ts`, `readSession(dir)` parses the untracked `.session` (`node` / `session` / `status`
lines) for a worktree, and `resolveLayout()` joins it with `git worktree list --porcelain`: it strips
`branchPrefix` from the branch for the node id (or takes `.session`'s `node` per `nodeFrom`), carries
`session`/`status` through, flags `isMain`, and computes the overlay `ops` via `worktreeSpecDelta`
against main for managed worktrees. The result is the `Worktree[]` consumed by `/api/layout` and by
[[sessions]]' `buildBoard`. The fuller `.session` lifecycle schema (`proposal`/`note`/`merges`) and its
writers belong to the [[sessions]] state machine in `sessions.ts`; this node owns only the read-side
link from worktree → node that `layout.ts` performs.

### verdict — not drifted

`layout.ts` is the only governed file and sits at this node's latest version with no commits ahead
(`spex lint` reports no `drift` warning for `worktree-linker`). The file advanced with the rename and
the board overlay; the expanded spec keeps describing the link itself (branch + `.session` → node +
overlay) and defers the richer session lifecycle to [[sessions]], so no other node's behavior is
back-written here. The raw source (map worktree → node via branch + untracked `.session`, compose by
keeping `.spec` in-tree) still holds.
