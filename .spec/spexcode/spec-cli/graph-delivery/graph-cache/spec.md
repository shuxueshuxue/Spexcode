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
  Under `SPEXCODE_BOARD_DEBUG=1`, each successful full or sessions cache publication emits one structured
  `cache-commit` row after its anchor is committed, carrying `stage=cache-commit`, `at`, `scope` and `buildMs`; validation hits,
  stale reads and failed, aborted or timed-out producers emit no such row.
- **Patrol verification is cache-owned.** Graph-stream's existing ~15s patrol does not manufacture a full
  invalidation. It asks the cache for the same single-flight refresh every other fresh reader uses. On a clean
  cache that refresh first compares one compact board-input revision: the served checkout's HEAD, `.spec` tree
  and config; the main branch tip; exact session records and originating prompt artifacts; each
  non-archived governed worktree's HEAD and `.spec` tree; the whole issue/remark-store stamp; and the current
  session-eval projection states. An equal revision returns the cached board and starts no assembly. A moved session record or
  projection revision takes the existing `sessions` splice; a moved graph/config/worktree/issue revision takes
  the existing `full` producer, so a blinded observer is still repaired and reported by [[graph-stream]]. This
  is the existing patrol timer's validation step, not a second poller or TTL. The revision is sampled around a
  real build; input movement while it runs leaves the result dirty for
  the next read even when the corresponding watcher event was missed. The completed board's own issue and
  projection values become the cache anchor, so verification never certifies a value the board did not carry.
  A slow validation or producer stays inside the same watchdog/abort/backoff path, and a patrol arriving during
  another refresh joins it rather than queueing a second operation.
- **Scoped invalidation (the dirty state carries independent obligations).** `invalidateBoard(scope)` records
  a structural `full` obligation and a session-projection obligation separately. A full signal still subsumes
  nothing except another structural full: when a sessions signal arrives in the same debounce window or while a
  route-owned/full producer is running, the cache owes **both** a full convergence and a sessions splice. A
  'sessions' read with a cached graph takes the SPLICE path — `spliceSessions(prev)`: one fresh
  `listSessions()` bracketed only by the record/prompt/resident-projection carrier (never a root/worktree
  `.spec` walk, issue read, identity read, or topology revision sample), prev's per-path ops reused, every node/eval/issue unit returned byte-identical — so a
  lifecycle write never re-walks 180 spec files to ship a 1KB patch (the measured waste this scoping
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
  watchdog/error discipline but is not serialized behind unrelated full assembly. The equivalence obligation — at one fixed eval-projection generation, a
  splice is indistinguishable from a full rebuild whenever only session state moved — is pinned by test,
  and the patrol's repair accounting
  ([[graph-stream]]) is the live alarm if it ever breaks.
- **Cache until change.** A completed build is served verbatim until a real change invalidates it, so a
  quiet poll storm costs ZERO builds (100 cached reads measured at ~0.1ms total). Invalidation is called
  by the EXACT signals [[graph-stream]] watches, before their debounce fires, so the cache can never lag
  a change the stream would push; a change landing MID-build opens the next dirty window so the next read
  rebuilds, while the just-finished build still answers its own waiters. The stream and
  the route share ONE build: `rebuildAndBroadcast` calls `getBoard()`.

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

**The same rule binds reading freshness, which is the larger half of a cold build's child work.** A window's
Git images and ordinary hunks are permanent properties of their commits, so the build asks for them ONCE.
Assembly therefore plans every node's rows first — a pure sidecar-read and axis projection that forks
nothing — then primes the content and anchor probes with the WHOLE demand set, and only then decorates rows
from settled verdicts. A corpus of N anchored readings costs one batch, not N. This is a cost boundary only:
the batch computes the same verdicts from the same immutable inputs, and the served board is byte-identical
to the reading-at-a-time path at every tip, which is the standing obligation whenever the batch is retuned.
The waste it removed is the shape to recognize again: priming per reading forked ~2,700 children to answer
~800 verdicts, of which ~2,500 were the same two `cat-file --batch` calls re-spawned per row — the exact
inverse of what a batch flag is for.

Because those object reads are build-wide rather than per-reading, they ride the same abort-aware async
transport as every other build child. A synchronous child is outside the permit pool and cannot see the
watchdog's signal, so it can be neither bounded nor killed; and one build-wide synchronous object read would
be precisely the uninterruptible stretch the async fs walks removed. Batch width therefore lengthens a queue
instead of widening a process tree or an argument vector: object reads are chunked to stay inside the
transport's output bound and a per-commit hunk query is chunked to stay inside the kernel's exec argument
limit, with overflow a loud error rather than a truncated parse. Collapsing the fan-out lowers the builder's
own peak footprint as well as its child count, so the platform obligation above is met by construction
rather than by a larger budget.

The budget covers how much memory a build's children may hold, not only how many may run. Git sizes its
mmap window, its mmap ceiling and its delta-base cache for a process that owns the machine, so a build's
heaviest history walks each mapped well over a hundred megabytes of pack to produce kilobytes of output —
inside the build's own platform. Every git call made under the build context therefore runs with those three
bounded, uniformly and blind to which walk it is; a call outside the context keeps git's defaults. It is a
resource boundary only: output, exit status and stderr are byte-identical under every setting, which is the
standing obligation whenever the bound is retuned.

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
