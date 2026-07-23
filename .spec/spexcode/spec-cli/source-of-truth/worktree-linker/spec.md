---
title: worktree-linker
status: merged
session: sess-design
hue: 190
desc: Map each governed session to its node + overlay — enumerated from the global store; an op must both differ from main's tip and be the branch's own post-fork work.
---
# worktree-linker

## raw source

A governed session's work is identified by its global **record** (its node, the live status, and the
`worktree_path` that holds the actual `.spec`/code change). The linker = enumerate the global store →
read each governed record → derive that worktree's real `.spec` proposal against main → overlay. Composable:
`.spec` stays in-tree, so adopting SpexCode needs no restructure, and the worktree stays pristine.

## expanded spec

A governed session's record ([[state]]/[[runtime]]) carries what identifies its work: the **node** it
proposes changes to (the authoritative ref it was bound to — the branch slug, with its `-<id4>` suffix,
falls back only when the record names none), the live **status**, and the **`worktree_path`**. The linker
reads the record, then derives the per-node overlay (`ops`) the board renders. The session set comes from
ENUMERATING the global store (filtered to `governed:true`), not from `git worktree list` — so an unmanaged
or scratch worktree never lands on the board.

An overlay op answers ONE question — *what would merging this worktree change in `.spec` on main, and did
THIS branch do it* — so an op must satisfy **two conditions at once**, each killing its own phantom class:

- **It differs from main's current tip** (the proposal half). The op set and each op's TYPE come from the
  working tree's diff against main's tip, so ops always speak in merge terms: a node main already has reads
  `edited`, never a spurious `added`, and content byte-equal to main is no op at all. This is what keeps a
  **foreign-base** branch honest — a branch whose fork point predates the `.spec` tree (an adopter's
  CR-review branch built on an upstream head plus a commit restoring `.spec`) previously reported the
  ENTIRE tree as `added` while its content was identical to main — and it likewise dissolves the stale ops
  of a worktree whose work has already LANDED on main.
- **The branch touched it since its fork point** (the attribution half — `git merge-base` with main). A
  worktree that is merely *behind* an advanced main made no change of its own; diffing against main alone
  would render main's newer post-fork content as phantom edits/deletes the worktree never made. Fork-point
  attribution keeps every genuine branch change — committed and uncommitted/dirty alike, that distinction
  unchanged — while pure behind-main staleness contributes nothing.

The overlay memo is keyed on exactly the inputs that can move the answer: fork point + worktree HEAD + the
`.spec` working-tree signature + **main's tip** — the last because a merge landing identical content must
dissolve the ops it just made moot; the recompute a main advance triggers stays cheap because every diff is
`.spec`-scoped.

This lives inside the [[portable-layout]] seam (`layout.ts`): the linker is the half that, given the
enumerated governed records, attaches node id + session + status + overlay to each. Keeping the session's
runtime state OUT of the worktree (in the global store) is what lets the same `.spec` tree stay in-tree and
canonical on main while a session layers ephemeral, session-scoped state on top without polluting history —
the worktree carries no SpexCode file at all, so there is nothing per-session to gitignore.
