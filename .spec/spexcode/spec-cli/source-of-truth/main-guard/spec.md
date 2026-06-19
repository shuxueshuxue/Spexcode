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

## current state

### description

`scripts/hooks/pre-commit` is the guard: it rejects a commit when on `main` unless `MERGE_HEAD` is
present (a merge) or `SPEXCODE_ALLOW_MAIN=1` is set, and it also runs as the thin `spex lint` shim
(see [[spec-lint]]). `scripts/install-hooks.sh` resolves `git rev-parse --git-common-dir`/hooks and
`install -m 0755`s the tracked sources there — it now installs **two** hooks: `pre-commit` (this
main-guard + lint shim) and `prepare-commit-msg` (the session-stamp that writes the `Session:` trailer
used for [[source-of-truth]] attribution), printing a confirmation line for each. The guard is advisory
(bypassable, and absent on any clone that skipped `npm run hooks`); the real enforcement is CI running
`spex lint`.

### verdict — not drifted

Both governed files sit at this node's latest version with no commits ahead (`spex lint` reports no
`drift` warning for `main-guard`). `install-hooks.sh` grew a second `install` line when the session
work added the `prepare-commit-msg` stamp; the expanded spec frames the installer as "copy the tracked
hook sources into the shared dir" and the description names both hooks it installs today — so the spec
states the durable mechanism while the description carries the concrete inventory, not a code detail
back-written to inflate the spec. The raw source (protect main with a hook, not a folder) still holds.
