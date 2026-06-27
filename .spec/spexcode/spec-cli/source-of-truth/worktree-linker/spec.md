---
title: worktree-linker
status: merged
session: sess-design
hue: 190
desc: Map each governed session to its node + overlay — enumerated from the global store, diffed at the fork point.
---
# worktree-linker

## raw source

A governed session's work is identified by its global **record** (its node, the live status, and the
`worktree_path` that holds the actual `.spec`/code change). The linker = enumerate the global store →
read each governed record → diff that worktree's `.spec` vs main at the fork point → overlay. Composable:
`.spec` stays in-tree, so adopting SpexCode needs no restructure, and the worktree stays pristine.

## expanded spec

A governed session's record ([[state]]/[[runtime]]) carries what identifies its work: the **node** it
proposes changes to (the authoritative ref it was bound to — the branch slug, with its `-<id4>` suffix,
falls back only when the record names none), the live **status**, and the **`worktree_path`**. The linker
reads the record, then diffs that worktree's `.spec` against main to produce the per-node overlay (`ops`)
the board renders. The session set comes from ENUMERATING the global store (filtered to `governed:true`),
not from `git worktree list` — so an unmanaged or scratch worktree never lands on the board.

The overlay diff is anchored at the worktree's **fork point** (`git merge-base` of the branch and
main), not at main's current HEAD. A worktree that is merely *behind* main (stale) made no change of
its own, so it must contribute no overlay; diffing against main HEAD instead wrongly rendered main's
newer post-fork content as a phantom edit the worktree never made. Anchoring at the fork point keeps
every genuine worktree change — committed on the branch and uncommitted/dirty alike, that distinction
unchanged — while pure behind-main staleness registers as nothing.

This lives inside the [[portable-layout]] seam (`layout.ts`): the linker is the half that, given the
enumerated governed records, attaches node id + session + status + overlay to each. Keeping the session's
runtime state OUT of the worktree (in the global store) is what lets the same `.spec` tree stay in-tree and
canonical on main while a session layers ephemeral, session-scoped state on top without polluting history —
the worktree carries no SpexCode file at all, so there is nothing per-session to gitignore.
