---
title: graph-stream
status: active
hue: 190
desc: The graph's push channel — an SSE with two modes (bare change signals, or hash-chained incremental patches) fed by domain-scoped freshness sources, self-healed by an accountable patrol.
code:
  - spec-cli/src/graphStream.ts
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
proof that this renders exactly what refetching would, is [[graph-delta]]'s contract.

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
which attaches a `.spec` subtree watch to each live worktree and detaches on removal; a draft spec edit
fires 'full' (overlays live on node units). And (0) the exported explicit nudge (`notifyBoardChanged`) for
a server-side mutation that must show regardless of watcher health — `/rename` passes 'sessions'. All
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

**Rebuilds are gated on someone listening.** With no delta subscriber the pipeline never builds — plain
subscribers get the zero-cost notify, a closed dashboard costs nothing (both pollers stop with their last
subscriber). With delta subscribers the debounced fire rebuilds ONCE through [[graph-cache]]'s single-flight
`getBoard()` (the SSE rebuild and a concurrent `/api/graph` poll share one assembly), broadcasts the patch,
and notifies plain streams only when the content tag actually moved. Every source is best-effort and never
throws: a source that can't start leaves that leaf to the patrol — which now actually covers it, and says so.

**Reconnect is free, and the ping is a contract.** A backend hot-reload drops the stream; `EventSource`
auto-reconnects and the fresh `graph-full` re-anchors the patch chain with no client-side repair logic. The
keep-alive `ping` (which also keeps idle proxies from timing the stream out) is promised every **10s** and
is the client's heartbeat: [[dashboard-shell]] holds the server to it — silence past 2.5 windows means a
DEAD stream to replace (the half-open deaths that fire no error event), so an undetectably dead connection
degrades to the poll for at most one watchdog window instead of forever. An old backend without this route,
a proxy that strips SSE, or a server that ignores `?mode=delta` still degrade to the plain protocol or the
poll — never to a frozen view. The full snapshot itself (first paint, resync) stays [[graph-lean]]'s cut
(issue #26), composing with — not replaced by — the delta path.
