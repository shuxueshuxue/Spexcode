---
title: source-of-truth
status: merged
session: sess-ce4e5cc
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
code:
  - spec-cli/src/specs.ts
  - spec-cli/src/git.ts
  - spec-cli/src/git.test.ts
---
# source-of-truth

## raw source

The canonical spec state is `.spec` on `main`. A worktree's `.spec` is never a rival truth — it is a
pending proposal, attributed to a session, that becomes the new version plus one history row on merge.
The dashboard is a **read-time aggregator over git, not a separate store**: because git *is* the
database, reading must scale with history, not with the number of nodes.

## expanded spec

A node's whole observable state is **derived here, not stored** — version (its count of content
commits), drift (governed code that moved ahead of the latest version), session (commit attribution),
and status. The loader reads `.spec` from the filesystem and overlays these git-derived facts. Nothing
is persisted beside it: no datastore, no hash files — every fact is recomputed from git on read. Drift is
netted against **acknowledgement**: a `Spec-OK: <node>` trailer checkpoints that node's spec valid at its
commit, quieting every drift commit at or below it back to the version — so one `spex ack` at the tip
clears a node's pending drift, not just on the exact commit that moved a file.

Two principles keep that derivation cheap on a long-running server:

- **Scale with history, not node count.** The whole `.spec` timeline is read in a single git walk and
  cached, so resolving every node is pure lookups rather than one history query per node. The arbitrary
  code paths that drift-checking touches are the lone exception — they fall outside the spec index and
  keep a per-file history walk.
- **Key the cache on real change, read from the filesystem.** A warm read spawns no git at all: the
  cache key is the current commit, read straight from `.git`, so it costs a file read, not a subprocess.
  A new commit moves the key and the board reflects the new version and drift at once; an unreadable
  key bypasses the cache and recomputes rather than ever serving stale data.

The same discipline governs the runtime reads the dashboard makes alongside the spec data. The board
**overlay** — each managed worktree's pending spec-delta versus `main`, owned by [[portable-layout]] —
is a pure function of the worktree's **fork point** (its merge-base with `main`), its HEAD, and its
working-tree `.spec`, memoized on exactly those. Keying on the fork point, not main's raw HEAD, is what
keeps the overlay both honest and cheap: a worktree merely behind a freshly-advanced `main` shares its
old fork point, so it stays a cache hit and never shows a phantom for content `main` moved, not it (the
anchoring itself lives in [[worktree-linker]]). The key costs one `git merge-base` per managed worktree;
HEAD and the `.spec` signature are filesystem reads, so a warm board re-runs no per-worktree diff yet
still reflects a fresh commit or edit immediately. Session liveness is owned by [[sessions]].

Status is a four-state derived value computed from version and drift, with frontmatter kept only as a
fallback when git is unreadable: the loader derives the git-only part (pending / drift / merged), and
the live **active** state is layered on by the board assembler from the worktree overlay. The four
states are specified in [[spec-node-states]]. The loader also attaches the body's two-part projection
— raw source and expanded spec — there being no agent-narrated current-state part, because what's-done
is derived, never narrated (see [[three-part-body]]).

This node owns the derivation pair: the loader/aggregator (`specs.ts`) and its git-access layer
(`git.ts`). The loader also assigns each node a unique-by-construction id: its leaf dir name, or the minimal
parent-qualified suffix when that name collides. The git layer exposes three call shapes by how
failure should behave: a sync read that throws (`git`, stderr piped so
a fail-soft probe stays quiet from a non-repo dir); an async read that hides failure as `''` (`gitA`); and a
fail-loud runner where the exit code IS the verdict (`gitTry`, returns ok + stderr). It also scopes the pre-commit drift gate to the commit's own staged
paths. All three strip an inherited `GIT_DIR`/work-tree env so a hook can't misdirect the op. The HTTP
entrypoint that serves the results belongs to [[spec-cli]].
