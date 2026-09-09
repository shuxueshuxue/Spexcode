---
title: graph-cache
status: active
hue: 185
desc: The graph is BUILT once per change, not once per poll — a single-flight, change-invalidated cache in front of buildBoard, so a poll storm costs one build and the assembly never blocks the liveness probe.
code:
  - spec-cli/src/graphCache.ts
related:
  - packages/spec-core/src/git.ts
  - spec-cli/src/graphScope.test.ts
  - spec-cli/src/graphCache.test.ts
---

# graph-cache

## raw source

`/api/graph` is the dashboard's hottest fetch, and the route ran `buildBoard()` inline on EVERY request.
Assembling the graph is expensive — cold, two full-history `git log` walks (~4–8s); warm, a full `.spec`
fs walk every time — and the ETag only saves the WIRE (it hashes the body *after* building). So N
overlapping polls (a normal dashboard's timer + SSE-triggered refetches) ran N simultaneous full builds,
and each build had ~1s of *synchronous* fs work that the `git` awaits could not hide. Measured: 10
concurrent polls drove the worst `/health` (a git-free `ok`) to **51s** — the event loop was starved and
the whole `:8787` server wedged. One real user's dashboard could take the backend down. The payload was
already lean ([[graph-lean]]) and freshness already pushed ([[graph-stream]]); what was missing was that
the *compute* was neither coalesced nor cached.

## expanded spec

The graph is built **once per change, not once per poll — and only as much of it as the change touched**.
`getBoard()` is the one seam every graph read goes through, and it holds three guarantees:

- **Single-flight.** One assembly runs at a time; concurrent callers share the in-flight promise. This IS
  the max-concurrent-builds cap — a poll storm can never fan out into N builds, it joins the one.
  Under `SPEXCODE_BOARD_DEBUG=1`, each successful full or sessions cache publication emits one structured
  `cache-commit` row after its anchor is committed, carrying `stage=cache-commit`, `at`, `scope` and `buildMs`; validation hits,
  stale reads and failed, aborted or timed-out producers emit no such row.
- **Revision-fenced publication.** A consumer that has observed a newer content revision on any source it
  reads asks the cache for a board whose publication has reached at least that revision. The fence asks the
  publication one question — is what is published new enough — and never how freshness is numbered, so a
  consumer with several sources ([[review-snapshot]] carries one revision per issue store) fences on all of
  them without folding them into one counter. The cache records a full invalidation and waits for
  publication, but an already-running flight that captured older source state cannot discharge that
  obligation: it may settle normally, then the still-owed full producer publishes what was required.
  This is one cache-owned publication fence, not API polling or a source-specific retry path; failure from
  either flight remains loud through the existing build/watchdog path.
- **Verification is cache-owned, and it is the FIRST step of every refresh.** A change signal names the leaf a
  watcher saw; that is not evidence the board moved. So every refresh — graph-stream's ~15s patrol, an HTTP
  read, a watcher-driven rebuild alike — first compares one compact board-input revision: the served checkout's
  HEAD, `.spec` tree and config; the main branch tip; exact session records and originating prompt artifacts
  together with the canonical session database's file identity (mtime, ctime, size — the lifecycle those
  envelopes no longer carry lives there, any process may commit to it, and journal_mode=delete rewrites the file
  in place on every commit; it is folded while any session record exists, because with none no row derives from
  the store and the store's own birth — the first canonical access inside a build initializes it — is not an
  input that moved during that build); each non-archived governed worktree's HEAD and `.spec` tree; and the
  whole issue/remark-store stamp. That list IS this cache's answer to "is this a board input?", and a
  producer's domain is DERIVED from what it says moved rather than assigned by whoever signalled. An equal
  revision returns the cached board and starts no assembly, whoever asked. A moved session record or database
  revision takes the `sessions` splice; a moved graph/config/worktree/issue revision takes the `full` producer,
  so a blinded observer is still repaired and reported by [[graph-stream]]. This is validation, not a second
  poller or TTL.

  Before sampling that revision, the graph boundary confirms that its resolved root is a Git repository. A
  directory before `git init` is a valid place to begin adoption but has no board to derive, so this read refuses
  with the shared absolute-path repair before session/runtime layout can run a raw Git command. CLI assembly and
  direct history reads consume that same precondition; a Git child that starts after the boundary still reports
  its real transport failure rather than being relabelled as an uninitialized workspace.

  The two obligations settle differently, because this revision can settle only one of them. A structural
  `full` claim whose full revision did not move is DISCHARGED without assembly — bytes the board never reads
  (a generated harness artifact rewritten inside a live worktree, a linked worktree no governed record names)
  bought a whole structural assembly before, which on an adopter-scale corpus is the difference between a
  cached read and a timed-out one. A `sessions` claim is never discharged here: liveness is graph-stream's
  poller axis, deliberately outside this revision, so a claimed session projection always takes its splice, and
  a projection the revision shows moved is owed one even when nothing signalled. Nothing is ignored by NAME —
  no filename table, no gitignore rule — because an adopter may govern generated and ignored paths; the only
  verdict is what the board actually reads.

  The revision is sampled around a real build, and the anchor names the sample the finished board is KNOWN to
  have read. Input movement while a producer runs leaves the result dirty for the next read even when the
  corresponding watcher event was missed, and that anchor keeps the pre-move value, so the re-owed obligation
  cannot discharge itself against a revision the board never carried and converge on nothing. The completed
  board's own issue stamp becomes part of the anchor, so verification never certifies a value the board did
  not carry. A slow validation or producer stays inside the same watchdog/abort/backoff path, and
  a refresh arriving during another joins it rather than queueing a second operation.
- **Scoped invalidation (the dirty state carries independent obligations).** `invalidateBoard(scope)` records
  a structural `full` obligation and a session-projection obligation separately — as CLAIMS, which the
  verification above then settles against the inputs. A full signal still subsumes
  nothing except another structural full: when a sessions signal arrives in the same debounce window or while a
  route-owned/full producer is running, the cache owes **both** a full convergence and a sessions splice. A
  'sessions' read with a cached graph takes the SPLICE path — `spliceSessions(prev)`: one fresh
  `listSessions()` bracketed only by the record/prompt/resident-projection carrier (never a root/worktree
  `.spec` walk, issue read, identity read, or topology revision sample), with prev's per-path ops reused. Ordinary
  lifecycle fields leave every node and issue unit byte-identical. Archive and close are the one subtractive
  topology transition already proven by that carrier: the splice removes overlays sourced by roots that left the
  active session set, drops empty ghost nodes, re-derives affected status/parent facts, and carries the old full
  revision minus those exact root entries. The active set is the row projection the splice actually publishes,
  not a raw `archived` bit: an invalid cold witness or reloaded-runtime hazard remains visible and keeps its root
  monitored. The subtractive path never reads a genuinely retired worktree. A root addition (create/resume) or
  any retained root revision movement remains a full obligation, so subtractive publication cannot hide new work.
  This classification belongs to the common `getBoard()` validation and publication path as well as delta delivery:
  a root-set reduction is a splice only when every other full input and every retained root digest is unchanged.
  Thus an ordinary route racing the lifecycle watcher cannot promote an archive into a full history build, while
  an addition or a retained-root change cannot borrow the subtractive carrier.
  A lifecycle write therefore never re-walks 180 spec files to ship a 1KB patch (the measured waste this scoping
  removed: ~250ms of unrelated fs work per push). A 'full' dirty (a ref move or worktree/.spec event) runs the
  whole `buildBoard()`, but its one structural builder does not queue that cheap projection: the splice inherits
  the last-good topology's full carrier and may publish first while the full builder remains single-flight. A
  concurrent full obligation remains independently owed and starts/continues its structural producer; the splice
  never scans topology to discover a missed full change. Its inherited full carrier lets the patrol detect that
  mismatch later and select the owed full repair instead of falsely certifying old nodes. The full
  producer captures the session-projection publication it assembled against; if a newer projection has already
  landed while it ran, completion synchronously re-bases those **published** rows onto the new topology through
  graph's one row-decoration/ops rule before publishing, so it cannot roll a visible session row back. It never
  waits for session-store quiet or performs another `listSessions()` in the full completion path: a later or
  not-yet-published session generation remains one owed cheap splice after the full commits. Thus continuous
  lifecycle writes cannot pin structural convergence, while a published lifecycle value cannot be replaced by an
  older full snapshot. The producer consumes only its own starting obligation: a later session completion during a
  long full build owes one splice, not another full build, while a full invalidation landing mid-splice still leaves structural full owed. Failure
  restores the consumed obligation. The structural builder remains single-flight; the session splice shares its
  watchdog/error discipline but is not serialized behind unrelated full assembly. The equivalence obligation — a splice is
  indistinguishable from a full rebuild whenever only session state moved — is pinned by test,
  and the patrol's repair accounting
  ([[graph-stream]]) is the live alarm if it ever breaks.
- **Cache until change.** A completed build is served verbatim until a real change invalidates it, so a
  quiet poll storm costs ZERO builds (100 cached reads measured at ~0.1ms total). Invalidation is called
  by the EXACT signals [[graph-stream]] watches, before their debounce fires, so the cache can never lag
  a change the stream would push; a change landing MID-build opens the next dirty window so the next read
  rebuilds, while the just-finished build still answers its own waiters. The stream and
  the route share ONE build: `rebuildAndBroadcast` calls `getBoard()`.

- **A board names itself once, where it is built.** A snapshot's bytes, its unit decomposition
  ([[graph-delta]]) and the content tag over that decomposition are three views of one build, so they are
  produced together and memoised together against the cached board. Two consequences, and the second is the
  reason the first is worth having. The cheap one: a poll storm of cache hits costs zero serialization and
  zero hashing, and a patrol tick that returns the anchor object re-serializes nothing. The load-bearing
  one: both delivery lanes then quote the SAME tag instead of each hashing its own answer to "which board
  is this" — the SSE chain's frame tag and the HTTP validator are one value, which is what makes a
  push-delivered board expressible on the conditional-request lane at all ([[dashboard-shell]]). Identity
  computed twice is identity that can disagree; the disagreement is not a hash collision but a category
  error, and it costs a full snapshot every time it happens.

  The tag is publishable only while the decomposition is faithful. `unitize`'s bijection precondition is
  checked per build, and a board that fails it has units that dropped a colliding id — such a tag no longer
  distinguishes this board from another, so the route publishes NO validator rather than one that cannot
  tell two boards apart. A malformed board degrades to full transfers, which is the same degradation the
  delta chain already makes for it, and never to a wrong 304.

Generated workspace build output is not a graph input. The project-root watcher excludes package `dist/` trees
and the atomic `.dist-next-*`/`.dist-previous-*` staging trees used by the compiler. A build must not invalidate
the board that is only serving the source tree, otherwise every artifact swap can start another full graph build
and turn a normal reload into backend event-loop and memory pressure.

- **Truthful stale-while-revalidate.** The cache has one explicit consistency seam with two policies. A
  first-cold read with no last-good board waits for the current build and fails or times out honestly; it
  never invents a snapshot. Once a last-good board exists, a dirty ordinary HTTP read returns that exact
  serialized board immediately with an explicit stale/refreshing signal and starts at most one background
  rebuild. Fresh waiters (the stream, delta path, and callers that need current content) join that same
  flight and wait for its completion, so a stale HTTP read cannot consume a stream update. While a session splice
  already owns the refresh, stale reads report that last-good board as refreshing and join neither a synthetic
  full build nor another splice; a full dirty obligation still starts its one structural builder alongside that
  independent splice. A failed
  background build keeps the last-good board, logs loudly, exposes a non-refreshing stale state during a
  bounded retry backoff, and never creates an unhandled rejection or a retry storm. A successful fresh
  completion replaces the JSON/ETag anchor and is the only event that makes the stale signal disappear.

- **A read pays for the freshness it claims.** Cache-until-change is only sound while something notices the
  change. Every producer above is owed by a SIGNAL, and a missed watcher event emits none — `dirty` never
  moves, so nothing re-reads disk and the cached board is served as current for as long as it is asked for.
  [[graph-stream]]'s patrol is the only unprompted sampler and it is gated on having a delta subscriber, so
  a polling-only client — a script, a CI job, a dashboard behind an SSE-hostile proxy — has nobody checking
  on its behalf. Measured on a quiet fixture with the project-root watcher deliberately blinded: a new spec
  node written to disk stayed invisible across every poll for as long as the polling ran, the route
  answering 304 against a board that no longer existed. So a stale-ok read whose last input sample has aged
  past the patrol's own cadence starts one itself. It does not wait for it — that caller still returns
  last-good bytes immediately — but the next reader gets the truth: measured, the same blinded change
  surfaced on the following poll. The cost lands on whoever is actually reading, which preserves the
  property that made the patrol subscriber-gated to begin with: with nobody looking, nothing runs.

  **A verification is not a refresh.** `x-spexcode-graph` speaks two words — `fresh`, and `stale,
  refreshing` — and a reader waiting on `fresh` is waiting on the BOARD, not on whether some background
  check happens to be running. A check that may well conclude nothing moved must not tell every idle reader
  its bytes are being superseded; conflating the two broke a real caller before the distinction existed. So
  a read-driven verification is neither stale nor refreshing until it finds something, at which point the
  ordinary dirty machinery reports it like any other obligation.

**A single board build also has a bounded git process budget.** Graph assembly may need to inspect every
linked worktree and governed session, but corpus width must lengthen the queue rather than widen the process
tree: every per-worktree/session git operation owned by one build passes through one abort-aware scheduler
with a fixed capacity of **four** children, independent of worktree and session counts. Ordinary CLI/API git
calls outside a graph build do not enter this pool. Waiting work observes the
build's abort before it starts, active children keep the existing kill-on-abort contract, and a settled build
leaves no queued or live descendants. Scheduling changes only cost, never graph meaning: cold graph content,
serialization/ETag, session overlays, delta units, and selected-demand behavior remain identical. Across
repeated successful full invalidations, RSS must naturally return to a stable platform below the old
unbounded-fanout peak; no forced collection, larger timeout/memory budget, history deletion, or deployment
special case is part of the mechanism.

The queue bounds unavoidable child work; graph assembly also removes avoidable child work. On the
large-history path, every governed path's drift question is asked against the same HEAD. The HEAD-keyed
drift index therefore loads reachable commit ids in one single-flight batch and every per-path reachability
verdict is a memory lookup — never one `merge-base --is-ancestor` process per path. A failed or aborted
batch is not cached, a retry can recover, and advancing a root to a new HEAD evicts its old set through the
same current-root cache ownership. Path-specific history remains lazy and bounded.

**How that equality may be measured is part of the obligation, because the board is NOT byte-reproducible
run to run on a live corpus.** Two runs of the SAME binary against a checkout that carries worktrees and
session records already differ: a session row's lifecycle, note and status are live state that moves
between two builds minutes apart. So a raw before/after diff there
reports the world's churn as a code difference. An equality claim on a live corpus therefore owes a
same-binary control run establishing which fields vary on their own; only fields that control proves are
per-process or live may be normalized, and every other field stays exactly as measured — normalization is
how a real difference is kept visible, never how it is absorbed. The complementary trap is the quiet one: a
corpus of fresh clones has no worktrees and no sessions, so the board's session half is empty on BOTH sides
and equality over it is vacuous — a green result that never touched the half a session-side change would
break. A claim about the whole board needs both substrates: pinned corpora for the node/issue half,
and a session-bearing one for the rest. This binds every reader of this cache, not only the batching above:
[[graph-stream]]'s invalidation and push half is measured against the same board and inherits the same rule.

The budget covers how much memory a build's children may hold, not only how many may run. Git sizes its
mmap window, its mmap ceiling and its delta-base cache for a process that owns the machine, so a build's
heaviest history walks each mapped well over a hundred megabytes of pack to produce kilobytes of output —
inside the build's own platform. Every git call made under the build context therefore runs with those three
bounded, uniformly and blind to which walk it is; a call outside the context keeps git's defaults. It is a
resource boundary only: output, exit status and stderr are byte-identical under every setting, which is the
standing obligation whenever the bound is retuned.

**The serialization is cached too.** `getBoardJson()` runs `JSON.stringify` once per build; a poll storm
of cache hits pays zero serialization CPU (only the ETag hash for the 304 path). The SSE path keeps the
object — it decomposes it into delta units ([[graph-delta]]).

**The build itself must not block the liveness probe.** Even coalesced to one, a build with a long
*synchronous* stretch freezes `/health`. The dominant stretch was the full-tree fs walk — `raws()` (the
spec.md walk), ~1s of uninterrupted `readFileSync`. Its hot twin `rawsAsync()` reads through `fs/promises`,
yielding the event loop between files, so `/health` answers *during* a build instead of behind it. The git
walks were already async+parallel and HEAD-cached (they never re-fork per node —
[[graph-lean]]/source-of-truth), so async fs closed the last sync gap. Only the hot graph path uses the
async twin; the light one-shot callers keep the sync form.

**Degrade loudly, never pile up — and the build NECESSARILY settles.** A build slower than a budget logs
one warning (the fail-loud regression alarm — a silent slow graph is how this returned). The route races
the build against a hard timeout: a genuinely-wedged build answers a 503 instead of holding a connection
open unboundedly. But "slow" and "never" are different failures: the single-flight slot is released
only when the underlying build settles, so a watchdog rejection can never let a second build start while
the first's git/fs work is still alive. The watchdog aborts the shared build signal; git children receive
that signal and are SIGKILLed, so the common wedge really terminates and the slot can recover. If a
non-process operation cannot be interrupted, the same slot remains occupied until it settles; later
readers receive the last-good board or the honest cold timeout, never a concurrent retry. The warning,
abort, release, and bounded backoff are one path: no abandoned child, unhandled rejection, or retry storm.
The process and memory contract is observable: after repeated successful full builds the active builder/
child count returns to its stable platform, and current-checkout history caches evict old HEAD entries
instead of retaining one full index per historical commit. Large-history drift/anchor reads use
path-scoped Git windows and reachability rather than materializing every commit/file edge; small repositories
keep the exact in-memory DAG path. A stale response gets a short flush window before background producer
setup, so a dirty HTTP burst is not blocked by the producer's synchronous pre-await work. Budget, route timeout, and watchdog are
env-overridable (`SPEXCODE_BOARD_BUDGET_MS` /
`SPEXCODE_BOARD_TIMEOUT_MS` / `SPEXCODE_BOARD_BUILD_TIMEOUT_MS`).

The same bound applies across session roots: each completed board snapshot reconciles the immutable history
cache against the backend checkout and the currently listed session worktrees, releasing roots that closed or
disappeared. A shared index remains warm while at least one live root references it; an unreferenced index is
removed immediately, so retained memory is bounded by live checkouts rather than the number of sessions that
have existed in the process.

**Where a full build's time goes is measured, so the budget warning names a lever instead of a mood.** The
`sourceIndexes` + `loadSpecs` baseline — history and drift included — is **shared with `spex spec lint`**,
so a no-server lint and the board pay most of their cost in common; what the board adds on top is its own
work — the session census and liveness, worktree layout and overlay discovery, the issue merge and review
fold, identity, and serializing the board — and that is where a budget warning should send a reader.

Two measurement pitfalls belong with any such number, because each produces a clean-looking wrong answer.
`startBuild()` defers its producer one event-loop turn and the warning timer starts after that defer, so
end-to-end waiting is a different quantity from the logged build time and the two may not be compared. And
one build per fresh process hides every in-process memo: a cold-only sample is the whole distance between
"a cache buys nothing here" and "this is the dominant cost", decided by sampling method alone ([[taste]]'s
sampling rule and its load-matched-pairs corollary).

This is the third half of [[graph-delivery]]'s one budget: [[graph-lean]] decides *how much* rides the
wire, [[graph-stream]] decides *when* the wire is paid, and graph-cache decides *how often the graph is
built* — one build per MEASURED change, shared by every reader.
