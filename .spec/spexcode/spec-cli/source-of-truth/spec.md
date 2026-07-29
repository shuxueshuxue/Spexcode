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
  - docs/audits/source-of-truth-stage2-20260728.md
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

Ownership itself has one relation algebra: exact path, directory prefix, or glob. The loader, candidate claim
preflight, eval changed-set selection, and session impact all call the same pure matcher; an immutable snapshot
changes where declarations are read, never what a declaration claims.

Git's default history presentation suppresses merge diffs, but a merge can author content or rename a lineage
while resolving conflicts. Dense combined (`--cc`) lines different from every parent are that merge's own
writes: a cc change to `spec.md` is a version, and one in governed code enters drift/anchor judgment. Combined
raw paths separately carry merge-authored rename identity into projection without charging the rename as a
code hit. A merge with neither stays transport. First-parent diff is not a substitute: it would duplicate
side-branch writes at the project's normal `--no-ff` landing step.

Two principles keep that derivation cheap on a long-running server:

- **Scale with history, not node count.** Ordinary repositories derive three shared event streams: `.spec`
  numstat for versions, repository-wide numstat for governed drift/acks, and one merge raw+patch stream for
  rename identity and all-parent authored lines. The persistent ledger appends immutable commit events and
  every verdict projects those events through the current tip's rename and ancestry topology. There is no
  path-scoped alternate representation: Git's path simplification, rename following, path reuse, and parallel
  rename forks cannot preserve the same identity relation, so a size threshold must not silently change the
  product meaning. Resolving any node is a pure lookup after that shared projection. The recent/history tab for a single node is served off
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

  The persistent event ledger has one **build-local transaction** across the history, drift, and
  merge-authorship streams. Let `H` be reachable commits, `L` the encoded ledger bytes, and `D` the newly
  reachable immutable events. A cold seed necessarily pays one `O(H)` Git extraction and one `O(L)` encode;
  an exact-tip hit pays one `O(L)` read, integrity pass, and decode with no event Git walk; an advancing tip
  pays one `O(L)` snapshot plus `O(D)` event extraction and at most one atomic `O(L + D)` replacement. The
  topology and the tip-relative projection are still rebuilt per build, because reachability, rename forks, and
  the walk-newest version rule are current-tip questions; the ledger removes repeated immutable-fact extraction,
  not that semantic lower bound. Its cost decomposes into three separate terms, and only the first is
  parameterized by the RENAME count. Every reachability question the projection asks compares some commit with a
  **rename** commit, so the reachability closure is held per consulted rename rather than per event: for `K`
  consulted renames, at most `2K` full-size closures, `O(K(H+G))` construction time over `H` reachable commits
  and `G` parent edges, and `O(KH)` retained bits. Holding the closure at the other end instead builds one per
  distinct EVENT commit — `Θ(events × H)` traversals and bits, and `Θ(H²)` on a linear history whose events all
  sit on one renamed path. That improvement is bounded only where it is claimed: the `2K` ceiling bounds
  full-size closure buffers, in count and bytes, against the event-keyed count; it does NOT bound runtime or
  edge visits, because a rename with many unrelated descendants traverses ground the event-side ancestor walk
  never touched. The other two terms are unchanged by that choice: one scan of the `N` immutable events, and the
  lineage walk itself, whose frontier compares each step's applicable renames pairwise — `Σ d(candidate)²`
  constant-time queries, worst case `Θ(NK²)` when one path carries `K` mutually incomparable renames. None of
  this is a linear-in-history promise, and `K` approaching `H` is quadratic again.
  Within one build, stream count must not multiply ledger work: all consumers share one decoded
  snapshot, one integrity verdict, and one locked merge/write, with no write-then-reload verification pass.
  The pair projector also parses the current-tip topology and tree-path listing once and passes those
  immutable projections to both history and drift builders; a shared `rev-list --parents` or `ls-tree`
  text must never be split into separate equivalent maps per builder.
  Cross-process writers still merge under the project-scoped lock; a corrupt or interpretation-mismatched
  snapshot rebuilds from Git, and a failed event scan remains loud rather than minting a marker.

  The expected peak-memory shape is one encoded ledger payload plus one decoded event state plus the current
  projection, not one copy of those per stream or per optimistic-lock retry. The slow full-history derivation
  remains the correctness oracle. Release evidence compares the two implementations in separate processes
  and homes on a fixed current tree, proves a known finding first, and reports cold, exact-tip, and advancing-tip
  wall, CPU, and peak RSS; a hit-rate win does not excuse a material cold or append RSS regression.
- **Keep candidates transient.** An explicit pending commit is not a checkout's current HEAD and may remain
  dangling after rejection. Its history/drift indices are shared only within the invoking lint call and are
  never registered in the root-owned HEAD cache, so it neither evicts that root's hot board index nor leaks
  one cache entry per rejected commit.
- **Key the cache on real change, read from the filesystem.** A warm read spawns no git at all: the
  cache key is the current commit, read straight from `.git`, so it costs a file read, not a subprocess.
  Shallow/graft bytes and the refs storage that can carry `refs/replace/*` are part of that filesystem
  identity; when their bytes move, Git re-resolves the canonical replacement targets before any ledger is
  reused, while unchanged storage reuses the already-resolved target set without another child process.
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
a fail-soft probe stays quiet from a non-repo dir); an async optional read that hides failure as `''` (`gitA`);
a runner where the exit code IS the verdict (`gitTry`, returns ok + stderr); and an unbounded streaming required
read (`gitRequiredA`) for history facts whose absence would change a verdict. Required derivation never turns a
spawn, timeout, non-zero exit, or fixed stdout buffer into an empty fact set. Inside a graph build all four also inherit that build's bounded pack footprint ([[graph-cache]]) —
one place decides it, every shape obeys it, and the transport never learns which walk it is running. All of them BOUND their
child: a git process that never exits (a wedged filesystem, a hijacked PATH git) is SIGKILLed after a
generous timeout (`SPEXCODE_GIT_TIMEOUT_MS`, sized far above the slowest legitimate full-history walk) and
the call fails like any other git failure — with a loud warning, since `gitA`'s `''` would otherwise
disguise the pathology as an innocently-empty result. A caller's awaited promise therefore always settles;
[[graph-cache]]'s settle guarantee leans on this. All four strip an inherited `GIT_DIR`/work-tree env so a
hook can't misdirect repository discovery; the local commit gate avoids the hook index entirely by judging
the real pending commit oid. The HTTP
entrypoint that serves the results belongs to [[spec-cli]].
