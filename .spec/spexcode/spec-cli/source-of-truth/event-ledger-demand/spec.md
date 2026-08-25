---
title: event-ledger-demand
status: active
hue: 205
desc: Foreground derived reads share the durable event ledger without queueing behind an unrelated writer's full build.
code:
  - packages/spec-core/src/git.ts#withEventCacheLock
  - packages/spec-core/src/git.ts#withEventLedgerBuild
  - packages/spec-core/src/git.ts#withEventLedgerDemand
  - packages/spec-core/src/git.ts#gitObjectInterpretation
related:
  - spec-eval/src/sessioneval.ts
  - spec-eval/src/sessioneval-ledger-demand.api.test.ts
---
# event-ledger-demand

## raw source

The event ledger is one durable truth, not one queue for every reader. A writer owns the project lock while it
derives missing immutable history and hunk facts and atomically replaces that ledger. A foreground product read
must consume the same integrity-checked representation without waiting for an unrelated writer's whole build.

## expanded spec

The ordinary build transaction remains the sole writer. It acquires the project-scoped lock, reads one complete
integrity-checked snapshot, lets every nested history and hunk consumer add facts to that build, rechecks the Git
interpretation identity, and performs at most one atomic replacement. Dead-owner recovery and bounded waiting
remain part of that writer contract. Lock authority is one exact process generation: PID, cross-platform process-start
token, and a per-acquisition nonce. A reused PID is dead authority, an unreadable identity (including an EPERM process
whose start token cannot be read) is unknown and fails loudly, and a lock that disappears after a losing create is a
normal release race that retries acquisition rather than inventing an unknown owner.

A foreground derived read first attempts that exact transaction without waiting. If the lock is free, the read is
the writer and missing immutable facts become durable exactly as before. If a live writer already owns the lock,
the foreground read opens the ledger's current atomic snapshot, runs the same derivation against it, and discards
only the immutable additions that this read discovered. It never substitutes an empty verdict: a missing fact is
derived from Git through the ordinary adapter, and a malformed ledger is rejected as a reusable snapshot and rebuilt
from Git. Git failures, unknown lock ownership, and repeated Git interpretation identity movement remain loud. The
concurrent writer may publish the same immutable fact later; either answer has the same semantics because the ledger
stores facts, not verdicts.

Demand is an ambient, lazy acquisition policy. Observer recovery waits, content revision reads, stable-cut replay, and
the non-ledger parts of review payload assembly take no lock; any nested history/hunk consumer enters the same demand
policy at its ordinary ledger seam. Each transaction therefore encloses only immutable ledger derivation, including a
cold review payload's real lint consumer, while the post-observer generation and content-revision fences remain after
derivation. List, summary, and export all inherit that policy, and a replay that needs no ledger fact never consults an
unrelated writer lock.

This is one read policy over one ledger format and one derivation engine. It adds no cache, generation, timeout,
path class, or background priority. Contention changes only who may persist newly derived immutable facts. A later
uncontended read still writes them through the ordinary transaction, so foreground availability does not turn the
durable ledger into a permanently read-only fast path.

## what the ledger holds and what a build costs

Ordinary repositories derive two shared event streams: one
  repository-wide NUL-framed raw identity stream for `.spec` content versions and governed drift/acks, and
  one merge raw+patch stream for rename identity and all-parent authored lines. The identity stream fixes
  `--root -M -l0 --raw -z --no-abbrev --no-ext-diff --no-textconv`: each compact record carries status, one
  path (or both rename endpoints), and old/new blob ids. Its blob predicate, not attribute-sensitive line
  counts, decides whether a one-parent `.spec` row is a version. Numeric numstat statistics are read only
  for the selected history node in one `diff-tree --stdin` batch, never retained in the shared ledger.
  The persistent ledger appends immutable commit events and
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
  

The persistent event ledger has one **build-local transaction** across the history, drift, merge-authorship,
  and anchor-hunk demands a build actually makes. It also holds immutable anchor hunk facts, not selector verdicts: each fact is
  keyed by the anchor engine's pinned range-semantics schema plus the ordered result/parent image identity
  (blob oid and historical path). A reader asks the ledger for its whole hunk demand once, derives only absent
  facts through Git, then joins those validated ranges to the already-open snapshot through the SAME lock and
  atomic replacement as event rows; the anchor engine never reopens, re-decodes, or independently writes that
  ledger. A missing fact costs its first derivation; a malformed ledger row is rejected as a whole ledger and
  rebuilt from Git. The ledger grammar version names both its identity and filename: adding a row type advances
  that version, so an older process never reads a new row then atomically writes it away; the new namespace
  seeds from Git. Parser units, selector resolution, windows, reachability, and lint verdicts remain
  process-local/current computations, so the ledger can never certify a changed selector or tree from an old
  answer. Let `H` be reachable commits, `L` the encoded ledger bytes, and `D` the newly
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
  distinct event commit that is actually compared against a rename — `C` of them, `O(C(H+G))` construction and
  `Θ(CH)` retained bits — which the linear history whose events all sit on one renamed path drives to `Θ(H²)`.
  That improvement is bounded only where it is claimed: the `2K` ceiling bounds full-size closure buffers, in
  count and bytes, against `C`; it does NOT bound runtime or edge visits, because a rename with many unrelated
  descendants traverses ground the event-side ancestor walk never touched. The other two terms are unchanged by
  that choice: one scan of the `N` immutable events, and the lineage walk itself, whose frontier compares each
  step's applicable renames pairwise — `Σ d(candidate)²` constant-time queries, worst case `Θ(NK²)` when one
  path carries `K` mutually incomparable renames. None of this is a linear-in-history promise: at `K ≈ H` the
  closure term is `O(H(H+G))` — quadratic only where the commit DAG is sparse enough that `G = O(H)` — and the
  unchanged frontier term is cubic when `N`, `K` and `H` grow together.
  Within one build, stream count and anchor demand must not multiply ledger work: all consumers share one decoded
  snapshot, one integrity verdict, and at most one locked merge/write, with no write-then-reload verification pass.
  The pair projector also parses the current-tip topology and tree-path listing once and passes those
  immutable projections to both history and drift builders; a shared `rev-list --parents` or `ls-tree`
  text must never be split into separate equivalent maps per builder.
  When `loadSpecs` already knows several current version bases and their named checkpoint acks, it parses
  each relation once and primes each finite query roster in one child-to-parent topology pass. The same
  prepared relation entries decide which bases need ancestry and become the relation published to consumers;
  the loader does not reconstruct either view. It first resolves the bases, then retains
  only the acks which can actually cover one of them. Each output is the same dense bitset an independent
  `ancestorsOf` lookup would have stored; the compact endpoint frontier is discarded on return, and an arbitrary
  later SHA still uses that normal lookup. This is a batch entrance to one current projection, never a persisted
  matrix or another reachability truth.
  Cross-process writers still merge under the project-scoped lock; a corrupt or interpretation-mismatched
  snapshot rebuilds from Git, and a failed event scan remains loud rather than minting a marker. The raw
  identity stream is parsed once at the Git adapter boundary through its structural NUL protocol; the ledger
  stores compact typed records and both projectors receive those records directly, so a
  pathname containing the human-facing record-separator byte can never reframe history.

  The expected peak-memory shape is one encoded ledger payload (events plus immutable hunk facts) plus one decoded event state plus the current
  projection, not one copy of those per stream or per optimistic-lock retry. The slow full-history derivation
  remains the correctness oracle. Release evidence compares the two implementations in separate processes
  and homes on a fixed current tree, proves a known finding first, and reports cold, exact-tip, and advancing-tip
  wall, CPU, and peak RSS; a hit-rate win does not excuse a material cold or append RSS regression.
