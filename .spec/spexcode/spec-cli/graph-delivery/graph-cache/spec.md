---
title: graph-cache
status: active
hue: 185
desc: The graph is BUILT once per change, not once per poll — a single-flight, change-invalidated cache in front of buildBoard, so a poll storm costs one build and the assembly never blocks the liveness probe.
code:
  - spec-cli/src/boardCache.ts
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

The graph is built **once per change, not once per poll**. `getBoard()` is the one seam every graph read
goes through, and it holds two guarantees:

- **Single-flight.** One `buildBoard()` runs at a time; concurrent callers share the in-flight promise.
  This IS the max-concurrent-builds cap — a poll storm can never fan out into N builds, it joins the one.
- **Cache until change.** A completed build is served verbatim until a real change invalidates it, so a
  quiet poll storm costs ZERO builds (100 cached reads measured at ~0.1ms total). Invalidation reuses the
  EXACT signals [[graph-stream]] already watches — a session-store write, a git-ref move, the cold tick —
  which now call `invalidateBoard()` before their debounce fires. So the cache can never lag a change the
  stream would push: a plain-mode poller sees fresh data on its next poll, and the SSE rebuild re-reads
  the same now-stale cache. A change that lands MID-build leaves the cache invalid (a generation counter
  detects it) so the next read rebuilds — the just-finished build still returns to its own waiters
  (freshest available when they asked), never cached as current. This mirrors [[graph-stream]]'s
  building/dirty loop, and the two now share ONE build: `rebuildAndBroadcast` calls `getBoard()`, so a
  route poll and the delta rebuild collapse into a single assembly.

**The serialization is cached too.** `getBoardJson()` runs `JSON.stringify` once per build; a poll storm
of cache hits pays zero serialization CPU (only the ETag hash for the 304 path). The SSE path keeps the
object — it decomposes it into delta units ([[graph-delta]]).

**The build itself must not block the liveness probe.** Even coalesced to one, a build with a long
*synchronous* stretch freezes `/health`. The two dominant stretches were full-tree fs walks — `raws()`
(the spec.md walk) and `yatsuNodes()` (the yatsu.md walk), ~1s of uninterrupted `readFileSync`. Their hot
twins `rawsAsync()`/`yatsuNodesAsync()` read through `fs/promises`, yielding the event loop between files,
so `/health` answers *during* a build instead of behind it. The git walks were already async+parallel and
HEAD-cached (they never re-fork per node — [[graph-lean]]/source-of-truth), so async fs closed the last
sync gap. Only the hot graph path uses the async twins; the light one-shot callers keep the sync forms.

**Degrade loudly, never pile up — and the build NECESSARILY settles.** A build slower than a budget logs
one warning (the fail-loud regression alarm — a silent slow graph is how this returned). The route races
the build against a hard timeout: a genuinely-wedged build answers a 503 instead of holding a connection
open unboundedly. But "slow" and "never" are different failures: the single-flight promise is released
only when the build settles, so a build that never settles (a hung git child, fs/promises under a starved
libuv threadpool) would otherwise pin `inflight` forever — every later read short-circuits into the pinned
promise before the cache's validity is even consulted, invalidation can't help, no log ever fires, and
only a restart cures it. So the build itself races a build-level watchdog at the single-flight boundary:
far above the slowest legitimate cold build, it REJECTS loudly (a warning names the wedge), and the
rejection flows through the same release path as success — `inflight` clears and the very next read
retries fresh. This one wall guarantees settlement for every cause, child process or not; the git layer's
own child timeouts ([[source-of-truth]]) merely make the common cause die sooner and reap the hung
children. Budget, route timeout, and watchdog are env-overridable (`SPEXCODE_BOARD_BUDGET_MS` /
`SPEXCODE_BOARD_TIMEOUT_MS` / `SPEXCODE_BOARD_BUILD_TIMEOUT_MS`).

This is the third half of [[graph-delivery]]'s one budget: [[graph-lean]] decides *how much* rides the
wire, [[graph-stream]] decides *when* the wire is paid, and graph-cache decides *how often the graph is
built* — one build per change, shared by every reader.
