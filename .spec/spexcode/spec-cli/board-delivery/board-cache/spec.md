---
title: board-cache
status: active
hue: 185
desc: The board is BUILT once per change, not once per poll — a single-flight, change-invalidated cache in front of buildBoard, so a poll storm costs one build and the assembly never blocks the liveness probe.
code:
  - spec-cli/src/boardCache.ts
---

# board-cache

## raw source

`/api/board` is the dashboard's hottest fetch, and the route ran `buildBoard()` inline on EVERY request.
Assembling the board is expensive — cold, two full-history `git log` walks (~4–8s); warm, a full `.spec`
fs walk every time — and the ETag only saves the WIRE (it hashes the body *after* building). So N
overlapping polls (a normal dashboard's timer + SSE-triggered refetches) ran N simultaneous full builds,
and each build had ~1s of *synchronous* fs work that the `git` awaits could not hide. Measured: 10
concurrent polls drove the worst `/health` (a git-free `ok`) to **51s** — the event loop was starved and
the whole `:8787` server wedged. One real user's dashboard could take the backend down. The payload was
already lean ([[board-lean]]) and freshness already pushed ([[board-stream]]); what was missing was that
the *compute* was neither coalesced nor cached.

## expanded spec

The board is built **once per change, not once per poll**. `getBoard()` is the one seam every board read
goes through, and it holds two guarantees:

- **Single-flight.** One `buildBoard()` runs at a time; concurrent callers share the in-flight promise.
  This IS the max-concurrent-builds cap — a poll storm can never fan out into N builds, it joins the one.
- **Cache until change.** A completed build is served verbatim until a real change invalidates it, so a
  quiet poll storm costs ZERO builds (100 cached reads measured at ~0.1ms total). Invalidation reuses the
  EXACT signals [[board-stream]] already watches — a session-store write, a git-ref move, the cold tick —
  which now call `invalidateBoard()` before their debounce fires. So the cache can never lag a change the
  stream would push: a plain-mode poller sees fresh data on its next poll, and the SSE rebuild re-reads
  the same now-stale cache. A change that lands MID-build leaves the cache invalid (a generation counter
  detects it) so the next read rebuilds — the just-finished build still returns to its own waiters
  (freshest available when they asked), never cached as current. This mirrors [[board-stream]]'s
  building/dirty loop, and the two now share ONE build: `rebuildAndBroadcast` calls `getBoard()`, so a
  route poll and the delta rebuild collapse into a single assembly.

**The serialization is cached too.** `getBoardJson()` runs `JSON.stringify` once per build; a poll storm
of cache hits pays zero serialization CPU (only the ETag hash for the 304 path). The SSE path keeps the
object — it decomposes it into delta units ([[board-delta]]).

**The build itself must not block the liveness probe.** Even coalesced to one, a build with a long
*synchronous* stretch freezes `/health`. The two dominant stretches were full-tree fs walks — `raws()`
(the spec.md walk) and `yatsuNodes()` (the yatsu.md walk), ~1s of uninterrupted `readFileSync`. Their hot
twins `rawsAsync()`/`yatsuNodesAsync()` read through `fs/promises`, yielding the event loop between files,
so `/health` answers *during* a build instead of behind it. The git walks were already async+parallel and
HEAD-cached (they never re-fork per node — [[board-lean]]/source-of-truth), so async fs closed the last
sync gap. Only the hot board path uses the async twins; the light one-shot callers keep the sync forms.

**Degrade loudly, never pile up.** A build slower than a budget logs one warning (the fail-loud regression
alarm — a silent slow board is how this returned). The route races the build against a hard timeout: a
genuinely-wedged build answers a 503 instead of holding a connection open unboundedly, while the
underlying single-flight build keeps running and caches for the next poll. Budget and timeout are env-
overridable (`SPEXCODE_BOARD_BUDGET_MS` / `SPEXCODE_BOARD_TIMEOUT_MS`).

This is the third half of [[board-delivery]]'s one budget: [[board-lean]] decides *how much* rides the
wire, [[board-stream]] decides *when* the wire is paid, and board-cache decides *how often the board is
built* — one build per change, shared by every reader.
