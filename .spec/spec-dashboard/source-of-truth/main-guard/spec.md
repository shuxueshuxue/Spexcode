---
title: main-guard
status: active
session: sess-merge
hue: 145
desc: Enforce the invariant — main only RECEIVES merges; all authoring happens in worktrees.
---
# main-guard

The model says main is the source of truth that every session branches from. The
directory layout doesn't protect it — `cd` to the root and you can still author on
main, breaking the invariant. Protection is a hook, not a folder structure.

A `pre-commit` hook rejects a direct commit while HEAD is `main`. Merges pass
(MERGE_HEAD present), so the worktree -> merge flow is unaffected. Escape hatch for
seeding / eager topology: `SPEXCODE_ALLOW_MAIN=1`. Installed via `npm run hooks`
into the common git dir, so it covers every worktree at once.

This makes "no direct commits on main" real instead of aspirational — the cheap
mechanism the portable layout's convention was relying on.
