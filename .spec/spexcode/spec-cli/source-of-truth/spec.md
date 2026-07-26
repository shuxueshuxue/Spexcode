---
title: source-of-truth
status: merged
session: sess-ce4e5cc
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
code:
  - spec-cli/src/specs.ts#loadSpecs
related:
  - spec-cli/src/git.ts
  - spec-cli/src/git.test.ts
  - spec-cli/src/specs.test.ts
---
# source-of-truth

## raw source

The canonical spec state is `.spec` on `main`. A worktree's `.spec` is never a rival truth — it is a
pending proposal, attributed to a session, that becomes the new version plus one history row on merge.
The spec is always the latest ground truth, never a record of finished work: a node is never "closed",
and one with no live session is simply content the next session opens and edits in place.
The dashboard is a **read-time aggregator over git, not a separate store**: because git *is* the
database, reading must scale with history, not with the number of nodes.

## expanded spec

A node's whole observable state is **derived here, not stored** — version (its count of content
commits), drift (governed code that moved ahead of the latest version), session (commit attribution),
and status. The loader reads `.spec` from the filesystem and overlays these git-derived facts. The
loader itself takes the **checkout root as a parameter** (default: the backend's own checkout): an eval
surface rooted at a session's worktree loads the spec tree from that same root, so a branch-ADDED node
exists for it — the pending-proposal principle applied to node existence, not only to readings. Nothing
is persisted beside it: no datastore, no hash files — every fact is recomputed from git on read. Drift is
netted against **acknowledgement**: a one-parent `spex ack` commit whose tree equals its sole parent's tree
checkpoints the named node valid at its tip, quieting drift reachable from that checkpoint back to the
version. Every other `Spec-OK` commit acknowledges only itself, never older debt; a merge is therefore
self-only even when an `ours` strategy leaves its first-parent tree unchanged, because it introduces new
reachable history.

An explicit local commit candidate is the one exception to the filesystem content source: lint reads raw
specs and governed current content from that candidate's immutable tree and derives both indices at the
same candidate tip. This keeps `commit --only`, partial staging and linked-worktree commits honest; an
unstaged working-tree edit cannot change the verdict for bytes absent from the candidate.

An exact-revision caller that already batch-read `.spec` may supply that immutable declaration snapshot to
`loadSpecs` so one projection does not read the same tree twice. The snapshot binds `{ tip, files }`; the
loader rejects a tip mismatch before deriving anything, and history/drift use that same requested tip. This
is caller-owned, build-local input, not a resident cache: ordinary filesystem reads and the existing
HEAD-owned indexes keep their current behavior.

Git's default history presentation suppresses merge diffs, but a merge can author real content while
resolving conflicts. The loader therefore treats a merge's dense combined (`--cc`) paths — content different
from every parent — as that merge's own writes. A cc change to `spec.md` is a real version and history row;
a cc change to governed code enters drift/anchor judgment. A clean merge has no combined path and remains
only transport. First-parent diff is not a substitute: it would duplicate every side-branch write at the
project's normal `--no-ff` landing step.

Two principles keep that derivation cheap on a long-running server:

- **Scale with history, not node count.** Ordinary repositories use two single git walks back the whole board:
  one over the `.spec` timeline (every node's version + history rows) and one `git log --name-only HEAD` over
  all files (the drift index), each cached on HEAD. For a large name-stream, the drift/anchor index switches
  to one batched HEAD commit-id set plus governed path-scoped `rev-list` windows, retaining the same DAG
  semantics without retaining every commit/file edge in JS or spawning one reachability child per reading.
  **Deciding which mode to use must not itself cost the walk it avoids.** The switch asks only whether the
  raw name stream reaches a byte budget, and that question is settled by the first budget-worth of bytes: the
  probe reads a bounded prefix and treats truncation as the verdict, which is exactly the answer the whole
  stream would give at every boundary. So the biggest histories — the ones the large-index mode exists for —
  pay the smallest probe, and a stream too wide to buffer can no longer come back empty and be mistaken for a
  small one.
  Resolving any node is a pure lookup in the small-index mode, while the large-index path memoizes bounded
  path windows. The recent/history tab for a single node is served off
  that same index plus one bounded per-node `git log` over its governed code paths, off the board's hot path.
  The `.spec` timeline is the **full reachable history**, not Git's default path-simplified presentation:
  every reachable one-parent content commit remains a version even when a later TREESAME merge would hide
  that side of a directory-scoped walk. Merge rows are then admitted separately by the all-parent authored-line
  predicate above, so restoring hidden ordinary commits never turns inherited merge content into a duplicate
  version. Single-parent rename aliases are coalesced independent of encounter order: if parallel branches
  edit the old and new paths, both histories join the current node, and the complete row set is ordered by
  one full-history date-order walk only after alias resolution. Date order retains walk-newest choice among
  parallel versions while forbidding an ancestor from displacing its own descendant merely because both
  commits share a timestamp. Alias continuity is event-scoped: reusing the vacated old path after the rename
  starts a separate node history. A pure rename remains a zero-content move.
  Both indices are read for **several checkouts at once** — the backend's own root plus every session
  worktree (the eval surfaces root their readings at the session's branch) — so the cache shares an
  in-flight promise for equal checkout heads while its ownership is keyed by the current checkout. When
  a root advances to a new HEAD, its old index is released immediately unless another live root still
  references that same HEAD. A small bounded set of current-root slots keeps several worktrees warm without
  retaining one full index for every historical commit, and concurrent readers of one HEAD share a single
  in-flight build.
- **Keep candidates transient.** An explicit pending commit is not a checkout's current HEAD and may remain
  dangling after rejection. Its history/drift indices are shared only within the invoking lint call and are
  never registered in the root-owned HEAD cache, so it neither evicts that root's hot board index nor leaks
  one cache entry per rejected commit.
- **Key the cache on real change, read from the filesystem.** A warm read spawns no git at all: the
  cache key is the current commit, read straight from `.git`, so it costs a file read, not a subprocess.
  A new commit moves the key and the board reflects the new version and drift at once; an unreadable
  key bypasses the cache and recomputes rather than ever serving stale data.

The same discipline governs the runtime reads the dashboard makes alongside the spec data. The board
**overlay** — each managed worktree's pending spec-delta versus `main`, owned by [[portable-layout]] —
is a pure function of the worktree's **fork point** (its merge-base with `main`), its HEAD, its
working-tree `.spec`, and **main's tip**, memoized on exactly those. An op must BOTH differ from main's
current content AND be the branch's own post-fork work, so neither staleness class paints a phantom: a
worktree merely behind a freshly-advanced `main` shows nothing for content `main` moved (not it), and a
foreign-base or already-landed tree whose content equals main shows nothing at all (the anchoring itself
lives in [[worktree-linker]]). The key costs one `git merge-base` per managed worktree plus one main-tip
resolve per board read; HEAD and the `.spec` signature are filesystem reads, so a warm board re-runs no
per-worktree diff yet still reflects a fresh commit, edit, or landed merge immediately. Session liveness
is owned by [[sessions]].

Status is a four-state derived value computed from version and drift, with frontmatter kept only as a
fallback when git is unreadable: the loader derives the git-only part (pending / drift / merged), and
the live **active** state is layered on by the board assembler from the worktree overlay. The four
states are specified in [[spec-node-states]]. The loader also attaches the body's two-part projection
— raw source and expanded spec — there being no agent-narrated current-state part, because what's-done
is derived, never narrated (see [[three-part-body]]).

This node owns the derivation pair: the loader/aggregator (`specs.ts`) and its git-access layer
(`git.ts`). The loader also assigns each node a unique-by-construction id: its leaf dir name, or the minimal
parent-qualified suffix when that name collides — always a single URL-safe token, never a `/`-path
([[id-url-safe]]). The git layer exposes four call shapes by how
failure should behave: a sync read that throws (`git`, stderr piped so
a fail-soft probe stays quiet from a non-repo dir); an async read that hides failure as `''` (`gitA`); a
fail-loud runner where the exit code IS the verdict (`gitTry`, returns ok + stderr); and a bounded-prefix
read for a caller that needs only the first N bytes (`gitPrefixA`), which stops the child at the caller's
byte budget and reports the truncation as its own answer — never as an empty result, which would invert the
size question it exists to answer. The budget is a byte count, so the transport stays blind to what the
bytes mean. Inside a graph build all four also inherit that build's bounded pack footprint ([[graph-cache]]) —
one place decides it, every shape obeys it, and the transport never learns which walk it is running. All of them BOUND their
child: a git process that never exits (a wedged filesystem, a hijacked PATH git) is SIGKILLed after a
generous timeout (`SPEXCODE_GIT_TIMEOUT_MS`, sized far above the slowest legitimate full-history walk) and
the call fails like any other git failure — with a loud warning, since `gitA`'s `''` would otherwise
disguise the pathology as an innocently-empty result. A caller's awaited promise therefore always settles;
[[graph-cache]]'s settle guarantee leans on this. All three strip an inherited `GIT_DIR`/work-tree env so a
hook can't misdirect repository discovery; the local commit gate avoids the hook index entirely by judging
the real pending commit oid. The HTTP
entrypoint that serves the results belongs to [[spec-cli]].
