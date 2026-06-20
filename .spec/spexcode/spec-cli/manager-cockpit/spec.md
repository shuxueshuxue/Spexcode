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
with a session, NOR to land it. The **server** does that work and hands back one ready-made answer. The
cockpit is the set of such verbs. **review** decides ("should I merge this session?") in a single payload;
**merge** is its sequel — it ACTS on the same gates the review reports, landing the session atomically.
Both are thin-called by the dashboard and `spex`. **close / dispatch** remain lifecycle actions on the same
surface.

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

`mergeSession(id)` is the ACT verb, served at `POST /api/sessions/:id/merge` (`?keep=1`) and run by
`spex merge <id> [--keep]`. It re-runs review's three gates fresh (via `reviewPayload`, so the decision and
the action read identical data) and, if ANY fails, merges NOTHING — returning `{merged:false, reason}`
(HTTP 409 / non-zero exit). A manager must never land a session that wouldn't pass its own review, so the
gate is fail-loud, not advisory. When all gates pass the SERVER runs `git -C <mainRoot> merge --no-ff
<branch>` with an auto-composed `merge <branch>: <reason>` message — reason = the node branch's latest
commit subject, minus a leading `spec: ` (the branch ref is visible from the main checkout, so no worktree
path is needed). It then CONFIRMS main's HEAD advanced to the new merge commit and aborts any half-merge,
so main is never left mid-state. On success it closes the session (worktree + branch) unless `--keep`, and
returns `{merged, head, closed}`. This makes landing a session ONE gated server transaction, not an
instruction dispatched to the session's agent — the agent never touches main.

Paths resolve from the CLI package's OWN location (`pkgRoot`), never a hardcoded repo layout, so the cockpit
works wherever the package lives. review only READS; merge is the cockpit's one deliberate WRITE, and it
mutates main only after every gate passes and only through the atomic transaction above.
