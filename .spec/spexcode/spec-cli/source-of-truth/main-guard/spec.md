---
title: main-guard
status: active
session: sess-merge
hue: 145
desc: Enforce the invariant — main only RECEIVES merges; all authoring happens in worktrees.
code:
  - spec-cli/templates/hooks/pre-commit
  - scripts/install-hooks.sh
---
# main-guard

## raw source

The model says the **trunk** is the source of truth that every session branches from. The directory
layout doesn't protect it — `cd` to the root and you can still author on it, breaking the invariant.
**Protection is a hook, not a folder structure.** Make "no direct commits on the trunk" real instead of
aspirational — the cheap mechanism the [[portable-layout]] convention was relying on.

## expanded spec

A `pre-commit` hook rejects a direct commit while `HEAD` is the **trunk**. Merges must pass (the
`--no-ff` gate onto the trunk sets `MERGE_HEAD`), so the worktree → merge flow is unaffected, and
node-branch commits pass because they aren't on the trunk. Escape hatch for seeding / eager topology:
`SPEXCODE_ALLOW_MAIN=1`.

One narrow exception is admitted on the trunk itself: a commit that touches **only** `.spec/.forum/**`.
That is the [[proposals]] forum's write path — the forum is **data, not contract** (it is not spec nodes;
it needs no review ritual), so a forum post appends straight to the trunk while every *contract* change
still goes through a worktree and a `--no-ff` merge. Any other staged path alongside the forum files
re-arms the guard, so the exception can't be used to smuggle real work onto the trunk.

The guard's real question is "am I committing directly onto the trunk?", not "is this branch literally
named `main`?". It resolves the trunk through the SAME single source of truth the rest of SpexCode
uses — [[portable-layout]]'s `mainBranch()` (config override → the main checkout's current branch →
`main`), surfaced to the shell as `spex trunk` — so a repo whose trunk is `master` or any non-`main`
base is protected, not silently exempt. A hardcoded `main` compare would disagree with the layout side
and leave a `master`-default repo wide open. When the CLI isn't resolvable (advisory mode, no
`@spexcode/spec-cli` installed) the hook falls back to a pure-git auto-detect of the main checkout's
current branch, then `main` — still naming the real trunk in the common case, never enumerating a second
hardcoded branch.

Hooks live in the **common** git dir, so one install covers every worktree at once. There is **one
canonical hook source** — the `spec-cli/templates/hooks/` shipped with the package — and **both** install
paths **iterate** it (not a hardcoded file list): `scripts/install-hooks.sh` (run via `npm run hooks`) for
this monorepo dogfooding itself, and [[spex-init]] for a project adopting SpexCode. Iterating the one source
is the point: a new hook template installs from both paths automatically, and a second hand-maintained list
could never drift out of sync because there is none. Because `.git/hooks/` is never committed,
installing is a per-clone onboarding step, re-run whenever the source changes (the installed copy is a
snapshot, not a symlink). The hook is advisory and bypassable; the non-bypassable backstop is [[ci-gate]].

This node owns **only** the main-authoring guard. The same `pre-commit` file also carries the
[[spec-lint]] shim (it runs `spex lint` after this gate), but that block is that node's contract, not
this one's — they share a file, not a concern.
