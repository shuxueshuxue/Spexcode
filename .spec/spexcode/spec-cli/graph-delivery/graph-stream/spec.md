---
title: graph-stream
status: active
hue: 190
desc: The graph's push channel — an SSE with two modes (bare change signals, or hash-chained incremental patches) fed by every freshness source the backend can see.
code:
  - spec-cli/src/graphStream.ts
---

# graph-stream

## raw source

The dashboard kept its status/grouping fresh by re-fetching the whole graph on a 4s timer, while the live
terminal rode a WebSocket. So a session's status change felt laggy (up to the poll interval) even though the
backend already knew it — two different freshness models on one screen. Give the graph the terminal's model:
the backend pushes and the dashboard follows, so status flips as fast as the characters do.

## expanded spec

graph-stream is the graph's live-delivery channel: `GET /api/graph/stream`, a server-sent-events stream a
dashboard opens once, server→client only, with a periodic keep-alive `ping` so an idle proxy never times it
out. It speaks two protocols on one route. **Plain mode** (no query) is the legacy contract, kept verbatim
for old clients: a bare `graph-changed` signal, the client refetches `/api/graph` on its ETag/304 path.
**Delta mode** (`?mode=delta`) inverts who fetches: the server sends a full snapshot on every (re)connect
(`graph-full {to, graph}`), then per change either the hash-chained patch (`graph-delta {from, to, set,
del}`) or a fresh full when the patch wouldn't win — the algebra, and the proof that this renders exactly
what refetching would, is [[graph-delta]]'s contract.

**Four event sources plus one explicit nudge, one debounced pipeline.** (1) A recursive `fs.watch` on the
per-user session store
([[runtime]]) — every lifecycle transition lands as a `session.json` write. (2) A watch on the shared git
dir's refs (loose refs recursively, `packed-refs`/`HEAD` beside them) — a commit or merge moves a ref the
moment it lands, so tree reshapes push instead of waiting out a poll. (3) A subscriber-gated ~2s poll of the
CHEAP tmux session signature ([[sessions]]) for the two signals that never touch a file: liveness (a crash /
going offline) and activity (the live self-summary headline). (4) A delta-gated ~15s cold tick — the
server-side twin of each client's slow fallback poll — that rebuilds and diffs so what no watcher
sees (an uncommitted worktree spec edit, a forge refresh, a watch blind spot like a recursively-deleted
store dir) still lands, once per tick total instead of once per open dashboard. And (0) an **exported
explicit nudge** (`notifyBoardChanged`) for a server-side mutation that must show instantly regardless of
watcher health — today just `/rename`, which writes the session's global record (`session.json`, inside
the watched store — [[session-rename]]); source 1 normally sees that write too, but its fs watch is
best-effort (it can fail to attach), so the route nudges the stream explicitly, making the sub-second
rename guarantee deterministic instead of watcher-dependent. All of them funnel into
one debounced fire that collapses a burst (a merge touches many records) into one signal.

**Rebuilds are gated on someone listening.** With no delta subscriber the pipeline never builds — plain
subscribers get the zero-cost notify they always did, and a closed dashboard costs nothing (the polls stop
with their last subscriber). With delta subscribers the debounced fire rebuilds ONCE, broadcasts the patch
to every delta stream, and notifies plain streams only when the graph's content tag actually moved — so a
signature wiggle that changes nothing no longer triggers a fleet of pointless refetches. That rebuild now
goes through [[graph-cache]]'s single-flight `getBoard()`, so the SSE rebuild and a concurrent `/api/graph`
poll share ONE assembly; and every change source calls `invalidateBoard()` before its debounce fires, so
the route's cache never lags a change the stream would push. Every source and
watch is best-effort and never throws: a source that can't start just leaves that path to the cold tick or
the client's own fallback.

**Reconnect is free — and undetectable death is survivable.** A backend hot-reload replaces the child and
drops the stream; `EventSource` auto-reconnects to the fresh child — and in delta mode the reconnect's
`graph-full` re-anchors the patch chain with no client-side repair logic. But a stream can also die
*silently* — a half-open tunnel, a sleep-resume, a network switch — delivering no data, no FIN, no `error`
event, indistinguishable client-side from a healthy quiet stream. The client deliberately does NOT try to
detect that (there is no liveness window to tune): its fallback poll never stands down, riding
`/api/graph`'s ETag/304 so a quiet graph costs headers only ([[dashboard-shell]]). The stream's `ping`
keep-alive exists for the *proxies* on the path, not as a client-side liveness proof. So an old backend
without this route, a proxy that strips SSE, a server that ignores `?mode=delta`, or an undetectably dead
connection all degrade to the plain protocol or the poll — never to a frozen view. What stays deliberately
unshrunk here is the full snapshot itself (first paint, resync): slimming that payload is [[graph-lean]]'s
ongoing cut (tracked as issue #26), composing with — not replaced by — the delta path.
