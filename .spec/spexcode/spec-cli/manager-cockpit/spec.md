---
title: manager-cockpit
status: active
hue: 200
desc: The cockpit API — server-computed verbs that let a manager review/act on sessions without hand-running git.
code:
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/git.ts
---

# manager-cockpit

## raw source

A manager — human or agent — shouldn't have to `cd` into a worktree and hand-run git to decide what to do
with a session. The **server** does that work and hands back one ready-made answer. The cockpit is the set
of such verbs; **review** is the first. It answers "should I merge this session?" in a single payload, so
the dashboard and `spex review` are thin callers of identical data. **merge / close / dispatch** follow as
later verbs on the same surface; they already exist as lifecycle actions and migrate under this contract.

## expanded spec

`reviewPayload(id)` (in [[state]]'s `sessions.ts`) computes ONE bundle for a session, served at
`GET /api/sessions/:id/review` and printed by `spex review <id>` (`--json` for the raw payload). Unknown id
→ `null` → HTTP 404 / a non-zero CLI exit. The independent reads run in parallel. The payload carries:

- **ahead** — commits the node branch is ahead of main.
- **dirtyNonRuntime** — uncommitted files, excluding the runtime files SpexCode itself writes into a
  worktree (the same set [[state]]'s commit gate ignores), so it counts only real spec/code work.
- **diff** — the worker's REAL changes, anchored at the **merge-base** (`mergeBaseDiff` in
  [[source-of-truth]]'s `git.ts`): per-file status + added/deleted line counts. A two-dot `main..HEAD` diff
  would show main's post-fork commits as phantom edits, so the fork point is the only honest base.
- **gates** — `conflictsWithMain` (a dry-run merge computed in the object store via `git merge-tree
  --write-tree` — no checkout, nothing to abort, the SAFE form of "would this conflict"); `typecheck`
  (`tsc --noEmit` on the CLI package at its own location); `lint` (the [[spec-lint]] module's error /
  warning counts). conflict/ahead/dirty/diff are session-specific; the typecheck/lint gates reflect the CLI
  package's own tree, where the command runs.
- **proposal** — the session's standing proposal kind + note, read from its `.session`.

Paths resolve from the CLI package's OWN location (`pkgRoot`), never a hardcoded repo layout, so the cockpit
works wherever the package lives. The server only ever READS here — computing a verdict, never mutating a
worktree or main; acting on the verdict (merge/close) stays a human-triggered lifecycle transition.
