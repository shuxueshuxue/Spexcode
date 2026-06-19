---
title: source-of-truth
status: merged
session: sess-ce4e5cc
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
code:
  - spec-cli/src/specs.ts
  - spec-cli/src/git.ts
  - spec-cli/src/index.ts
---
# source-of-truth

## raw source

The canonical spec state is `.spec` on `main`. A worktree's `.spec` is never a rival truth — it is a
pending proposal, attributed to a session; on merge it becomes the new version plus one history entry.
The dashboard is a **read-time aggregator over git, not a separate store**. Because git *is* the
database, reading it must scale with history, not with how many nodes ask.

## expanded spec

A node's *whole* observable state is **derived** here, not stored: `version` (content-commit count),
`drift` (governed code ahead of the latest version), `session` (commit attribution), and `status`. The
loader reads `.spec` from the filesystem and overlays git-derived facts.

To scale with history rather than node count, the aggregator walks the whole `.spec` timeline in a
**single `git log` pass** (`historyIndex` in `git.ts`), bucketing every commit's rows by each file's
current path and following reparent renames backward in-memory — so a moved node still reads as one
continuous history and a pure move never counts as a version. The result is cached on `HEAD`
(committed history is immutable, so a warm read is one `rev-parse`). This replaces the old per-node
`git log --follow` (`O(nodes × commits)`); `loadSpecs` now does one walk regardless of node count.
Every git read on the serving path goes through the **async** helper (`gitA`), never the sync `git()`:
synchronous `execFileSync` spawns via `fork()`, whose cost scales with the API server's resident memory,
so in the long-running server each sync spawn is slow and degrades as RSS grows. Async spawning keeps the
event loop free and the reads flat regardless of process size; `loadSpecs`/`specHistory` are async and
fetch their independent indexes in parallel.
Arbitrary non-`.spec` files (the governed *code* paths `spex lint` checks) keep the per-file `--follow`
path, since the bulk index only covers `.spec`.

Status is a four-state derived value (`deriveStatus`), computed from version + drift, with frontmatter
kept only as a fallback when git is unreadable. `loadSpecs` derives the git-only part
(pending/drift/merged); the live `active` state, which needs the worktree overlay, is layered on by the
board assembler. The four-state model is specified in [[spec-node-states]]. `loadSpecs` also attaches the
`parts` projection — now a **two-part** body (raw source + expanded spec), the agent-narrated current-state
part having been dropped because what's-done is derived, never narrated (see [[three-part-body]]). The
parser lives with `parseParts`, but the projection rides out on the same node objects this aggregator builds.

Concretely, `specs.ts` is the aggregator: `loadSpecs()` calls `historyIndex`/`driftIndex` once (both cached
on `HEAD`), then for each node under `.spec` does pure lookups — `rowsFor` for the version timeline,
`driftFor` per governed file for `driftFiles`/`drift`, `deriveStatus` for `status`, and `parseParts` for
`parts`. Session attribution comes from the latest version's `Session:` trailer, with frontmatter `session:`
only as a fallback. `specHistory(id)` returns the per-node timeline with each row's line-diff scoped to that
node: its `spec.md` stats come from the cached bulk index (rename-followed), and the governed-code stats from
one `git log --numstat` walk over the node's `code` paths (`pathsStats`), looked up per version — replacing
the old `git show`-per-version loop, so a whole node's history is two git spawns rather than one per row.
`git.ts` provides the git access (`historyIndex`, `driftIndex`/`driftFor`, `rowsFor`, `statsFor`, `pathsStats`,
the async `gitA`, and the hook-safe `git()` helper that strips a hook's exported `GIT_DIR`/`GIT_INDEX_FILE`);
`index.ts` serves the results. Nothing is
stored: no datastore, no hash files — every fact is recomputed from git on read, warm-cached on `HEAD`.
