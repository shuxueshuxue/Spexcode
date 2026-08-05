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
- **Revision-fenced publication.** A consumer that has observed a newer resident-forge content revision asks
  the cache for a board that carries at least that revision. The cache records a full invalidation and waits
  for publication, but an already-running flight that captured an older forge slice cannot discharge that
  obligation: it may settle normally, then the still-owed full producer publishes the required revision.
  This is one cache-owned publication fence, not API polling or a forge-specific retry path; failure from
  either flight remains loud through the existing build/watchdog path.
- **Verification is cache-owned, and it is the FIRST step of every refresh.** A change signal names the leaf a
  watcher saw; that is not evidence the board moved. So every refresh — graph-stream's ~15s patrol, an HTTP
  read, a watcher-driven rebuild alike — first compares one compact board-input revision: the served checkout's
  HEAD, `.spec` tree and config; the main branch tip; exact session records and originating prompt artifacts;
  each non-archived governed worktree's HEAD and `.spec` tree; the whole issue/remark-store stamp; and the
  current session-eval projection states. That list IS this cache's answer to "is this a board input?", and a
  producer's domain is DERIVED from what it says moved rather than assigned by whoever signalled. An equal
  revision returns the cached board and starts no assembly, whoever asked. A moved session record or projection
  revision takes the `sessions` splice; a moved graph/config/worktree/issue revision takes the `full` producer,
  so a blinded observer is still repaired and reported by [[graph-stream]]. This is validation, not a second
  poller or TTL.

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
  board's own issue and projection values become part of the anchor, so verification never certifies a value
  the board did not carry. A slow validation or producer stays inside the same watchdog/abort/backoff path, and
  a refresh arriving during another joins it rather than queueing a second operation.
- **Scoped invalidation (the dirty state carries independent obligations).** `invalidateBoard(scope)` records
  a structural `full` obligation and a session-projection obligation separately — as CLAIMS, which the
  verification above then settles against the inputs. A full signal still subsumes
  nothing except another structural full: when a sessions signal arrives in the same debounce window or while a
  route-owned/full producer is running, the cache owes **both** a full convergence and a sessions splice. A
  'sessions' read with a cached graph takes the SPLICE path — `spliceSessions(prev)`: one fresh
  `listSessions()` bracketed only by the record/prompt/resident-projection carrier (never a root/worktree
  `.spec` walk, issue read, identity read, or topology revision sample), with prev's per-path ops reused. Ordinary
  lifecycle fields leave every node/eval/issue unit byte-identical. Archive and close are the one subtractive
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
from settled verdicts. The invariant is that anchored-reading cost is bounded by what the verdicts actually
require and is INDEPENDENT of the reading count N — never one batch per reading. That is the property to
preserve; "one batch" was its original spelling because the two then coincided: every window was scanned to
its end, so the whole demand set was known before any bytes moved and one batch WAS the entire read. A board
asks the anchor engine only whether a window holds ANY hit ([[code-anchor]]'s existence read), so the scan
stops at its first hit and the demand set must be discovered rather than declared; it advances in
corpus-wide rounds whose number is bounded by hit DEPTH, still independent of N. Rounds that asked one
reading at a time would re-fork the batch per unit, which is exactly what this rule forbids. This is a cost
boundary only: the same verdicts are computed from the same immutable inputs, and the served board is
byte-identical to the reading-at-a-time path at every tip, which is the standing obligation whenever the
batch is retuned. The waste it removed is the shape to recognize again: priming per reading forked ~2,700
children to answer ~800 verdicts, of which ~2,500 were the same two `cat-file --batch` calls re-spawned per
row — the exact inverse of what a batch flag is for. Scanning a window past its first hit is the same shape
one layer up: measured on this corpus, it parsed 1,158 historical file revisions (52.6 MB through the host
TypeScript parser) to settle 858 booleans that 307 revisions (21.9 MB) already decide.

The same invariant binds the CURRENT-tree half, and along a different axis. Before a reading's code axis may
testify, every `code:` selector is resolved against the working tree, which parses that file — and a node's
entries are asked one at a time, so the identical file was re-parsed once per entry: measured, 922 parses
over 46 distinct files, 40.4 MB, and again on every rebuild because nothing carried the result. Extraction is
a pure function of (text, path, extractor), so the bound is DISTINCT CONTENT, never the entry count: one
parse per content digest, reused for every entry that content backs and across rebuilds until the bytes
change. The key is a digest and never mtime or size, because this gate decides whether a reading may testify
at all — a stale unit list would let a dead selector read as alive, the exact silence this gate exists to
break — and digesting costs about a tenth of parsing, so the read remains and only the parse is saved.

Two costs this build still pays are named here rather than folded in, because each needs its own argument.
The per-revision extraction memo is process-local, so a cold process re-parses revisions a previous one
already settled; making it durable is a persistent-state decision that must argue its own case against
[[drift-by-ancestry]]'s no-stored-state rule, not ride in as a cost tweak.

That case has now been costed, and it does not close. Correctness is not the obstacle: the memo key already
names an immutable Git object plus the complete parse identity the extractor contract demands (schema, host
compiler path AND version, parse options, filename), so content that changes changes the oid and a compiler
that changes changes the key — a durable entry has no staleness mode. What fails is the trade. Measured on
this corpus: a fresh process assembles in **8,249ms**, and every subsequent full rebuild in that same process
takes **1,108/1,007/1,011ms with zero parses**. The whole ~7.2s a durable ledger could recover is therefore
paid ONCE PER PROCESS, not once per rebuild — while a live backend rebuilds on every commit and every issue
write, and already pays only the second number. Buying a shared on-disk ledger — concurrent writers from the
several backends a box runs, corruption handling, bounded growth — to shorten one startup is complexity that
does not buy itself back. Recorded as decided-against with its measurement, not as an open question, so the
next reader inherits the number instead of re-deriving the idea.

Extraction is synchronous, and that is a LIVENESS question rather than a latency taste: `/health` computes
nothing, so its latency measures only whether the loop can turn, and a probe that cannot answer is
indistinguishable from a dead backend — the CLI allows a recorded backend 600ms and the supervisor allows a
booting child 1000ms before it keeps the old one. Reducing how much is parsed shortens the stretch
proportionally but never makes it yield, so the two repairs are separate and both are owed. The sweep that
resolves every reading's selectors against the working tree was the dominant offender: nothing in that
doubly-nested loop awaited, so it held the loop 1,104ms in one uninterrupted stretch. It now yields on a time
budget, and `setImmediate` is the yield that matters — awaiting a synchronous-bodied `async` function only
drains microtasks and never returns to the I/O phase. Measured across three cold builds, the worst `/health`
sample fell 1,122ms → 507/530/552ms, and no sample exceeds the 600ms the CLI judges by.

What remains is a floor, not a residue: **the longest indivisible step is one parse of the largest governed
file, measured at 440ms**, and no yield can subdivide a single `createSourceFile`. So a scenario bound
stricter than that cannot be met by scheduling alone — only by moving extraction off the event-loop thread.
That option is now costed too, and it is decided against for the same reason as the durable ledger: not
because a worker is expensive, but because the floor is paid ONCE. Measured across four consecutive builds in
one process, the sweep's longest uninterrupted hold is 457ms on the first and 50/55/53ms on the rest — the
yield budget itself, an order of magnitude under every threshold that acts on this signal. A long-lived
backend rebuilds on every commit and every issue write and pays only the second number; the first is a
process-start event. Buying worker infrastructure to shorten one startup does not buy itself back.

**How that equality may be measured is part of the obligation, because the board is NOT byte-reproducible
run to run on a live corpus.** Two runs of the SAME binary against a checkout that carries worktrees and
session records already differ: `evalSummary.epoch` is minted once per process, and a row's lifecycle, note
and status are live state that moves between two builds minutes apart. So a raw before/after diff there
reports the world's churn as a code difference. An equality claim on a live corpus therefore owes a
same-binary control run establishing which fields vary on their own; only fields that control proves are
per-process or live may be normalized, and every other field stays exactly as measured — normalization is
how a real difference is kept visible, never how it is absorbed. The complementary trap is the quiet one: a
corpus of fresh clones has no worktrees and no sessions, so the board's session half is empty on BOTH sides
and equality over it is vacuous — a green result that never touched the half a session-side change would
break. A claim about the whole board needs both substrates: pinned corpora for the node/eval/issue half,
and a session-bearing one for the rest. This binds every reader of this cache, not only the batching above:
[[graph-stream]]'s invalidation and push half is measured against the same board and inherits the same rule.

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

**Where a full build's time actually goes — measured, so the budget warning names a lever instead of a mood.**
On a 476-node adopter corpus (429 nodes carrying `eval.md`, 2,521 declared scenarios, 3,023 stored readings) a
fresh-process full build logged 1710 / 1825 / 1870 ms against the 1500ms budget. The `sourceIndexes` +
`loadSpecs` baseline — history and drift included — is 394–524ms of that and is **shared with `spex spec lint`**,
which is why a no-server lint of the same corpus finishes at 1.61s wall while the board needs more: the
difference is not the tree walk. Board-only work, in size order: eval timeline and freshness derivation
778–876ms, the `.spec`/`eval.md` walk 227–405ms, the scenario and remark index 109–129ms, session census and
liveness 98–119ms, worktree layout and overlay discovery 102–108ms — and then everything else (overlay/ghost
projection, issue merge, review fold, the resident session-eval copy, identity, and serializing a 583KB board)
under 7ms each. Inside freshness, selector-anchor verification alone is 558.7–591.8ms while the content
fallback across all 3,023 readings is 29.7–35.8ms.

The dimension is readings and their code axes, not node count. At 119 / 238 / 357 / 476 ids the readings go
882 / 1,543 / 2,176 / 3,023 while full freshness goes 621.0 / 663.9 / 714.6 / 911.7 ms — **sublinear**, which
says the cost is a fixed sum re-paid per build rather than a walk that scales wrongly, and that distinction is
the entire lever: those 3,023 reading demands deduplicate to **73 distinct selector queries**, an answer set the
current HEAD already determines. A full build triggered by an issue, worktree or session change re-derives all
73 with HEAD unmoved. Ordering without freshness (`order: true`, 229.8ms) is not the substitute it looks like —
it deliberately emits `freshnessDeferred`, and the review summary's counts need real fresh/stale decisions.

Two measurement pitfalls belong with those numbers, because both produce a wrong answer that looks clean.
`startBuild()` deliberately defers its producer one event-loop turn and the warning timer starts after that
defer, so end-to-end waiting (2117–2329ms on the same corpus) is a different quantity from the logged build
time and the two may not be compared. And a 3755ms sample from a live server is a real slow sample of this same
path, not a corpus floor: that run was interleaved with asynchronous `session summary build failed` and
resource-monitor work, while the board's own synchronous `sessionEvalProjections()` call measures 0.4ms in an
isolated process.

This is the third half of [[graph-delivery]]'s one budget: [[graph-lean]] decides *how much* rides the
wire, [[graph-stream]] decides *when* the wire is paid, and graph-cache decides *how often the graph is
built* — one build per MEASURED change, shared by every reader.
