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

The overlay diff is anchored at the worktree's **fork point** (`git merge-base` of the branch and
main), not at main's current HEAD. A worktree that is merely *behind* main (stale) made no change of
its own, so it must contribute no overlay; diffing against main HEAD instead wrongly rendered main's
newer post-fork content as a phantom edit the worktree never made. Anchoring at the fork point keeps
every genuine worktree change — committed on the branch and uncommitted/dirty alike, that distinction
unchanged — while pure behind-main staleness registers as nothing.

This lives inside the [[portable-layout]] seam (`layout.ts`): the linker is the half that, given the
enumerated worktrees, attaches node id + session + status + overlay to each. Keeping `.session`
untracked is what lets the same `.spec` tree stay in-tree and canonical on main while a worktree layers
ephemeral, session-scoped state on top without polluting history.

The per-worktree generated runtime files — `.session`, `.session-prompt`, and `.spex-hooks.json`
(the last written by `writeSettings()` with absolute paths) — are **gitignored**, never tracked.
