---
title: proposals
status: pending
hue: 200
desc: An async taste FORUM — a session records whatever felt off (even off-mainline) as a spec-shaped proposal others sign/discuss; a supervisor drains it into real work. Data, not contract, so the product graph never sees it. (Pending — design captured, implementation deferred to an issue.)
---

# proposals

## raw source

An agent finishing a task notices things that feel off — a smell, an awkward boundary, a wish — often
unrelated to its mainline. That judgment is **taste**, and it must not evaporate when the session ends. So a
finished session records such concerns into one shared, durable **forum**; other sessions sign and discuss
them like an async chatroom; a supervisor later drains the forum into real work. This keeps **global** taste
flowing into the codebase's shape, instead of every agent owning only its own slice and losing the whole.

## expanded spec

The forum is a **spec-SHAPED tree** at `<root>/.proposal` (parallel to `.config`): each proposal is a node
(`spec.md`: a one-line concern + the body), each signed reply a **child "post" node**, deeper children
in-thread replies. But the forum is **DATA, not contract** — so the product graph must never treat it as
nodes: the spec walk must skip `.proposal`, and `isSpecMd` must exclude it (so the board overlay shows no
ghost), so **lint / drift / deriveStatus never see the forum**. It carries its own loader, its own status,
its own surface.

- **Own lifecycle status**, forum-authored never git-derived: `open` → `accepted | rejected | landed`. A
  proposal may name the product `nodes:` it concerns, linking back into the graph (`[[…]]`).
- **Write in the author's own worktree, self-commit on its node branch** — so the commit-gate's clean-tree
  check still holds and the proposal rides that session's merge. **Read unions `.proposal` across the main
  checkout + every live worktree** (the board's read-from-worktrees model), so a proposal surfaces the
  moment it is committed, before its branch merges.
- **Surface:** `spex propose "<concern>" [--node <id>…] [--body -|<text>]`; `propose reply|sign|resolve <id>`;
  `spex proposals [--node] [--all] [--json]` is the drain view. A finished session is nudged toward the forum
  by a **non-blocking Stop-hook advisory** ([[state]]'s clean-done path) — the forum is **non-blind**: read
  it, sign/reply if your concern is already raised, else open a new one.
- **Dedup is the drain's job, not the write's.** Duplicate proposals are a **signal** (recurrence), folded
  into one thread by a supervisor's judgment ([[supervisor]]) — never a write-time similarity match. And
  recurrence is weighed as **salience, not importance**: a sharp singleton outranks a popular gripe, so the
  count never becomes the priority ranking.

Out of scope (sibling nodes): a dashboard forum view; an automated drainer (the supervisor drains by hand).
