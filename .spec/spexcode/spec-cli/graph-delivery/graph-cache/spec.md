---
title: graph-cache
status: active
hue: 185
desc: The graph is BUILT once per change, not once per poll — a single-flight, change-invalidated cache in front of buildBoard, so a poll storm costs one build and the assembly never blocks the liveness probe.
code:
  - spec-cli/src/graphCache.ts
related:
  - spec-cli/src/git.ts
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
- **Scoped invalidation (the dirty bit carries a domain).** `invalidateBoard(scope)` marks the cache
  'sessions'-dirty or 'full'-dirty, escalating (sessions∪full=full) and never downgrading. A
  'sessions'-dirty read with a cached graph takes the SPLICE path — `spliceSessions(prev)`: one fresh
  `listSessions()`, prev's per-path ops reused, every node/eval/issue unit returned byte-identical — so a
  lifecycle write never re-walks 180 spec files to ship a 1KB patch (the measured waste this scoping
  removed: ~250ms of unrelated fs work per push). A 'full' dirty (a ref move, a worktree/.spec event, the
  patrol) runs the whole `buildBoard()`. The splice runs under the SAME single-flight promise, watchdog
  and generation rules as a full build; a 'full' invalidation landing mid-splice leaves the cache
  full-dirty for the next read. The equivalence obligation — at one fixed eval-projection generation, a
  splice is indistinguishable from a full rebuild whenever only session state moved — is pinned by test,
  and the patrol's repair accounting
  ([[graph-stream]]) is the live alarm if it ever breaks.
- **Cache until change.** A completed build is served verbatim until a real change invalidates it, so a
  quiet poll storm costs ZERO builds (100 cached reads measured at ~0.1ms total). Invalidation is called
  by the EXACT signals [[graph-stream]] watches, before their debounce fires, so the cache can never lag
  a change the stream would push; a change landing MID-build leaves the cache dirty (generation counter)
  so the next read rebuilds, while the just-finished build still answers its own waiters. The stream and
  the route share ONE build: `rebuildAndBroadcast` calls `getBoard()`.

- **Truthful stale-while-revalidate.** The cache has one explicit consistency seam with two policies. A
  first-cold read with no last-good board waits for the current build and fails or times out honestly; it
  never invents a snapshot. Once a last-good board exists, a dirty ordinary HTTP read returns that exact
  serialized board immediately with an explicit stale/refreshing signal and starts at most one background
  rebuild. Fresh waiters (the stream, delta path, and callers that need current content) join that same
  flight and wait for its completion, so a stale HTTP read cannot consume a stream update. A failed
  background build keeps the last-good board, logs loudly, exposes a non-refreshing stale state during a
  bounded retry backoff, and never creates an unhandled rejection or a retry storm. A successful fresh
  completion replaces the JSON/ETag anchor and is the only event that makes the stale signal disappear.

Session rows' eval summaries compose with this cache rather than hiding inside it ([[session-eval]]): graph
assembly batch-reads a separate content-addressed projection cache and may start only its missing/invalidated
entries. A summary completion invalidates the board at `sessions` scope, so the sessions splice attaches the
new stable projection without rebuilding node/eval/issue units. Lifecycle-only splices reuse unchanged summary
entries; a relevant refs/worktree/remark event first advances their own generations, then invalidates the board.
The graph cache therefore never fans out a full session-eval build, and a quiet cache hit starts zero eval work.

Projection warmup is subscriber-gated and bounded: an ordinary HTTP/CLI graph read never starts historical
session-eval work merely because session records exist. The delta stream enables warmup for the current era;
the projection runner drains that work through a bounded queue, so one board change cannot fan out one full
git/history build per session. When the last delta subscriber leaves, new warmup is disabled (in-flight work
is allowed to settle and is never overlapped by a second batch); scoped Evals demand remains the explicit
way to build an individual session's full model.

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
large-history path, all reading anchors ask the same question against the same HEAD. The HEAD-keyed drift
index therefore loads reachable commit ids in one single-flight batch and every per-reading reachability
verdict is a memory lookup — never one `merge-base --is-ancestor` process per reading. A failed or aborted
batch is not cached, a retry can recover, and advancing a root to a new HEAD evicts its old set through the
same current-root cache ownership. Path-specific history remains lazy and bounded.

Bounding processes is not enough on its own, because what a build RETAINS scales too. A fold over an
adopted corpus reads many off-history anchors, and asking each of them a repository-wide question made the
build's own heap — not its child processes — the binding term. So the off-history content fallback asks
only about the governed paths each reading claims and keeps only those verdicts ([[eval-core]]); retention
scales with governed breadth, not repository width, and the same three-round platform obligation covers the
builder's own memory, not merely its descendants.

**The serialization is cached too.** `getBoardJson()` runs `JSON.stringify` once per build; a poll storm
of cache hits pays zero serialization CPU (only the ETag hash for the 304 path). The SSE path keeps the
object — it decomposes it into delta units ([[graph-delta]]).

**The build itself must not block the liveness probe.** Even coalesced to one, a build with a long
*synchronous* stretch freezes `/health`. The two dominant stretches were full-tree fs walks — `raws()`
(the spec.md walk) and `evalNodes()` (the eval.md walk), ~1s of uninterrupted `readFileSync`. Their hot
twins `rawsAsync()`/`evalNodesAsync()` read through `fs/promises`, yielding the event loop between files,
so `/health` answers *during* a build instead of behind it. The git walks were already async+parallel and
HEAD-cached (they never re-fork per node — [[graph-lean]]/source-of-truth), so async fs closed the last
sync gap. Only the hot graph path uses the async twins; the light one-shot callers keep the sync forms.

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

This is the third half of [[graph-delivery]]'s one budget: [[graph-lean]] decides *how much* rides the
wire, [[graph-stream]] decides *when* the wire is paid, and graph-cache decides *how often the graph is
built* — one build per change, shared by every reader.
