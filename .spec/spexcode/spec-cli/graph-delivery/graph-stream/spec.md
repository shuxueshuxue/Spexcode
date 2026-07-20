---
title: graph-stream
status: active
hue: 190
desc: The graph's push channel — an SSE with two modes (bare change signals, or hash-chained incremental patches) fed by domain-scoped freshness sources, self-healed by an accountable patrol.
code:
  - spec-cli/src/graphStream.ts
related:
  - spec-cli/src/graphStream.test.ts
---

# graph-stream

## raw source

The dashboard kept its status/grouping fresh by re-fetching the whole graph on a 4s timer, while the live
terminal rode a WebSocket. So a session's status change felt laggy (up to the poll interval) even though the
backend already knew it — two different freshness models on one screen. Give the graph the terminal's model:
the backend pushes and the dashboard follows, so status flips as fast as the characters do. Then the probe
campaign measured the push itself: a one-field lifecycle write cost a flat 150ms wait plus a full ~250ms
graph rebuild before its 1KB patch went out. The signal must carry its DOMAIN, so a session change pays a
sessions-only splice — and every leaf that can be watched IS watched, so the patrol stops being load-bearing.

## expanded spec

graph-stream is the graph's live-delivery channel: `GET /api/graph/stream`, a server-sent-events stream a
dashboard opens once, server→client only. It speaks two protocols on one route. **Plain mode** (no query) is
the legacy contract, kept verbatim for old clients: a bare `graph-changed` signal, the client refetches
`/api/graph` on its ETag/304 path. **Delta mode** (`?mode=delta`) inverts who fetches: the server sends a
full snapshot on every (re)connect (`graph-full {to, graph}`), then per change either the hash-chained patch
(`graph-delta {from, to, set, del}`) or a fresh full when the patch wouldn't win — the algebra, and the
proof that this renders exactly what refetching would, is [[graph-delta]]'s contract. The cached anchor
snapshot a connecting subscriber is seeded with lives exactly as long as its subscriber era: with zero
delta subscribers nothing rebuilds on change, so the anchor dies with the era's last unsub (and a build
that completes after it caches nothing) — a new era's first frame is a fresh build, never a kept frame
from before the gap, whose missing sessions would empty the client's warm-terminal panes (issue #70).

**Every change signal carries its domain.** `fireChanged(scope)` — 'sessions' or 'full' — feeds
[[graph-cache]]'s scoped invalidation, so a session-only change is answered by the sessions SPLICE (fresh
`listSessions`, every other unit reused) instead of a full assembly: measured, the store-write→push path
dropped from ~420ms median to ~56ms on the dogfood corpus. The sources and their scopes: (1) recursive
`fs.watch` on the per-user session store ([[runtime]]) → 'sessions'. (2) the git dir's refs (loose refs
recursively, `packed-refs`/`HEAD`) → 'full' — a commit legitimately reshapes nodes, drift, overlays and
eval anchors at once, which is why refs stay full-scope rather than pretending to a narrower domain. (3)
TWO subscriber-gated pollers for what never touches a file ([[state]]): a ~100ms HOT tier (`hotSignature`
— pure-syscall death detection over launch-registered pids) and a ~1s WARM tier (`warmSignature` — one
merged tmux call for window/title state plus the rendezvous tri-state), both → 'sessions'. (4) the
`.git/worktrees` REGISTRY watcher — git's own birth-ledger for every worktree, hand-made or dispatched —
which attaches one recursive root watch plus one non-recursive gitdir watch to each live worktree and detaches
both on removal. Root events cover dirty governed source, renames, draft scenario declarations and reading
sidecars; the gitdir watch covers `index` changes from stage/reset that do not rewrite the working file. Both
fire 'full'. Only `.git` transport metadata (covered by its own watchers) and `node_modules` dependency bytes
are ignored; generated project paths are not guessed away, because an adopter may govern them. A
pathless/overflow-like event or watcher error is treated as an unknown full change, never ignored. For the eval
projection specifically, losing either the refs observer or a worktree observer places a keyed hold before the
graph rebuild: the affected summary remains updating with last-known and cannot compute current while the source
is absent. The one immediate resubscribe attempt installs its replacement first, removes only that source's hold,
then advances and performs an authoritative rebuild; a persistent failure remains held until a later canonical
registry/request setup retries it. And (0) the exported explicit nudge (`notifyBoardChanged`) for
a server-side mutation that must show regardless of watcher health — `/rename` passes 'sessions', and the
issue/remark write routes pass 'full' **atomically with their store persist** ([[remark-substrate]]
write-visibility: the writer's own post-write refetch must never race an asynchronous fs event into the
stale cache; the issue store dir is deliberately not a watched leaf — one mechanism per surface). All
funnel into one debounced fire; the debounce is **25ms**, sized to the MEASURED fs-event burst width
(0–5ms for real declares/renames, single-digit ms for ref moves) — the in-flight build's dirty-rerun loop
is the coalescer for anything wider, so the old flat 150ms was pure added latency.

**The patrol is a self-heal authority, not a crutch — and it is accountable.** The delta-gated ~15s cold
tick now `invalidateBoard('full')`s before it rebuilds (it once read the still-valid cache back — a no-op
patrol, found by measurement: an uncommitted worktree edit stayed invisible through five ticks while a
control write propagated in 231ms). A patrol rebuild whose diff is non-empty when NO leaf watcher signalled
logs a loud `PATROL-REPAIR` naming the changed units: a repair means some leaf is blind, and the target
state is repairs/hour = 0. `SPEXCODE_DISABLE_WATCHERS` (csv: store, refs, worktrees) deliberately blinds a
leaf so tests can prove the patrol catches and reports what it misses; `SPEXCODE_BOARD_DEBUG=1` logs every
broadcast's changed units, trigger tags and build cost.

The patrol is deliberately **not an eval-summary correctness source** ([[session-eval]]). It neither advances a
session eval input generation nor starts a periodic fingerprint/build. Session-eval coherence is a state machine
over canonical events: a relevant refs/worktree/explicit-write event first increments the affected cache
generation and makes the session unit `updating(lastKnown)`, then the existing graph debounce ships that state;
the stable latest-generation result later replaces it through this same envelope. A burst increments through its
events but may publish/build only the newest generation. No summary-specific SSE, WebSocket, endpoint poll, or
timer exists.

**Rebuilds are gated on someone listening.** With no delta subscriber the pipeline never builds — plain
subscribers get the zero-cost notify, a closed dashboard costs nothing (both pollers stop with their last
subscriber). With delta subscribers the debounced fire rebuilds ONCE through [[graph-cache]]'s single-flight
`getBoard()` (the SSE rebuild and a concurrent `/api/graph` poll share one assembly), broadcasts the patch,
and notifies plain streams only when the content tag actually moved. Every source is best-effort and never
throws. The patrol can still repair ordinary graph units and reports that repair; an eval input source that
cannot start instead leaves its projection observer-held and visibly non-current until the source is restored.

**Reconnect is free, and the ping is a contract.** A backend hot-reload drops the stream; `EventSource`
auto-reconnects and the fresh `graph-full` re-anchors the patch chain with no client-side repair logic. The
keep-alive `ping` (which also keeps idle proxies from timing the stream out) is promised every **10s** and
is only transport liveness, never data freshness. [[dashboard-shell]] holds the server to it — silence past 2.5 windows means a
DEAD stream to replace (the half-open deaths that fire no error event), so an undetectably dead connection
marks session summaries last-known and reopens the stream; only the reconnect's authoritative `graph-full`
certifies them current again. An old backend without this route,
a proxy that strips SSE, or a server that ignores `?mode=delta` still degrade to the plain protocol or the
poll — never to a frozen view. The full snapshot itself (first paint, resync) stays [[graph-lean]]'s cut
(issue #26), composing with — not replaced by — the delta path.
