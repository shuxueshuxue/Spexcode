---
title: main-guard
status: active
session: sess-merge
hue: 145
desc: Enforce the invariant — main only RECEIVES merges; all authoring happens in worktrees.
code:
  - scripts/hooks/pre-commit
  - scripts/install-hooks.sh
---
# main-guard

## raw source

The model says `main` is the source of truth that every session branches from. The directory layout
doesn't protect it — `cd` to the root and you can still author on `main`, breaking the invariant.
**Protection is a hook, not a folder structure.** Make "no direct commits on main" real instead of
aspirational — the cheap mechanism the [[portable-layout]] convention was relying on.

## expanded spec

A `pre-commit` hook rejects a direct commit while `HEAD` is `main`. Merges must pass (the `--no-ff`
gate onto main sets `MERGE_HEAD`), so the worktree → merge flow is unaffected, and node-branch commits
pass because they aren't on `main`. Escape hatch for seeding / eager topology: `SPEXCODE_ALLOW_MAIN=1`.

Hooks live in the **common** git dir, so one install covers every worktree at once. The installer
(`scripts/install-hooks.sh`, run via `npm run hooks`) copies the repo's tracked hook sources into that
shared dir. Because `.git/hooks/` is never committed, this is a per-clone onboarding step, re-run
whenever a hook source changes (the installed copy is a snapshot, not a symlink).
