---
title: source-of-truth
status: merged
session: sess-ce4e5cc
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
code:
  - packages/spec-core/src/specs.ts#loadSpecs
related:
  - packages/spec-core/src/git.ts
  - spec-cli/src/git.test.ts
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
is persisted beside it: no datastore, no hash files — every fact is recomputed from git on read. Drift is netted against acknowledgement by the one ack-cover rule [[drift-by-ancestry]] states.

**A body reference is NOT a loaded edge.** The loader used to resolve every `[[id]]` a body names into a
per-node `mentions` list and ship it with the node. It is gone, and what removed it is a judgement about
what a node HAS rather than a cost: a prose mention is a fact about the graph — who cites whom — and never
was a fact about the node itself, so shipping it on every row made the loader answer a question nobody had
asked of the node it was answering about ([[context-dock]] retired the surface that consumed it). The
`bodyMentions` parser stays where it is, with the one consumer that must actually resolve a name: the
mention lint rule ([[spec-lint]]), which rejects a `[[id]]` naming nothing. The frontmatter relations are a
different axis and stay one — `code:`/`related:` claim FILE paths, so neither can name a node.

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

Two principles keep that derivation cheap on a long-running server:

- **Scale with history, not node count.** The derivation reads one shared, persistent event ledger per project and projects it through the current tip;
  what that ledger holds, how it is transacted, and what each build costs in reachable history are
  [[event-ledger-demand]]'s contract. Several checkouts share one index per HEAD under [[root-lru]]'s ownership rule.
- **Keep candidates transient.** A pending commit's indices live only inside the lint call that judges it and never
  enter the HEAD cache ([[root-lru]]).
- **Key the cache on real change, read from the filesystem.** A warm read spawns no git at all: the
  cache key is the current commit, read straight from `.git`, so it costs a file read, not a subprocess.
  Shallow/graft bytes and the refs storage that can carry `refs/replace/*` are part of that filesystem
  identity; when their bytes move, Git re-resolves the canonical replacement targets before any ledger is
  reused, while unchanged storage reuses the already-resolved target set without another child process.
  A new commit moves the key and the board reflects the new version and drift at once; an unreadable
  key bypasses the cache and recomputes rather than ever serving stale data.

The board **overlay** — each managed worktree's pending spec-delta versus `main` — is [[worktree-linker]]'s pure
function of fork point, worktree HEAD, working-tree `.spec`, and main's tip, memoized on exactly those; session
liveness is owned by [[sessions]].

Status is a four-state derived value computed from version and drift, with frontmatter kept only as a
fallback when git is unreadable: the loader derives the git-only part (pending / drift / merged), and
the live **active** state is layered on by the board assembler from the worktree overlay. The four
states are specified in [[spec-node-states]]. The loader also attaches the body's two-part projection
— raw source and expanded spec — there being no agent-narrated current-state part, because what's-done
is derived, never narrated (see [[three-part-body]]).

A directory before `git init` has no Git-backed graph to derive; the Git-workspace boundary owns that refusal
([[git-exec]]).

This node owns the derivation pair: the loader/aggregator (`specs.ts`) and its git-access layer
(`git.ts`). The loader also assigns each node a unique-by-construction id: its leaf dir name, or the minimal
parent-qualified suffix when that name collides — always a single URL-safe token, never a `/`-path
([[id-url-safe]]). The git layer's four call shapes, their bounded children, and their environment hygiene are [[git-exec]]'s.

`loadSpecs` publishes a node's relation as PARSED ENTRIES, and the flat shapes beside them are views of that
one source. `codeEntries`/`relatedEntries` are the relation; `code`/`related` are its base paths for the many
consumers that want files, and `codeScoped`/`relatedScoped` the selector-bearing subset for the anchor
engine. Deriving all of them here, once, from a single parse is what keeps every downstream layer from
re-deriving one shape out of another: a consumer handed only the views had to mint `path#selector` strings
and re-parse them to recover entries the loader already held, which is precisely the round-trip the eval
layer's fixed-revision projection used to perform. Publish the source, derive the views; never ship only the
views and make someone reconstruct the source.
