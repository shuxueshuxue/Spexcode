---
title: board-stream
status: active
hue: 190
desc: The board's push channel — an SSE that fires on session-store change so the dashboard reloads on real transitions, not on a tight poll.
code:
  - spec-cli/src/boardStream.ts
---

# board-stream

## raw source

The dashboard kept its status/grouping fresh by re-fetching the whole board on a 4s timer, while the live
terminal rode a WebSocket. So a session's status change felt laggy (up to the poll interval) even though the
backend already knew it — two different freshness models on one screen. Give the board the terminal's model:
the backend pushes a "something changed" signal and the dashboard reloads on it, so status flips as fast as
the characters do.

## expanded spec

board-stream is the board's live-delivery channel: `GET /api/board/stream`, a server-sent-events stream a
dashboard opens once. It is server→client only — no request body, no client frames — and carries no board
payload. It emits a bare `board-changed` signal; the client refetches `/api/board` on it, reusing that
route's conditional-request (ETag/304) path. The board stays rebuilt on demand and this stream stays tiny.

**Two event sources, all subscribers.** The session-side of the board has two kinds of change, and only one
lands as a file, so the channel watches both. (1) A recursive `fs.watch` on the per-user session store
([[runtime]]): every lifecycle status transition lands as a write to `sessions/<id>/session.json` (the harness
hooks author it), so a record write *is* the board-changed signal for status/grouping. (2) A subscriber-gated
poll (~2s) of the CHEAP session signature ([[sessions]]) — two tmux calls, no git — for the signals that are
tmux-derived, not file writes: **liveness** (a worker crashing / going offline) and **activity** (a worker's
live self-summary headline). Neither writes a session file, so the fs-watch is blind to them; before this poll
they only reached the board on the slow fallback, which is why a finished-but-crashed worker or a moving
headline lagged. Both sources fire the same debounced `board-changed`, fanned to every open stream; the poll
runs only while someone is subscribed (a closed dashboard costs nothing) and stops when the last stream drops.

**Only the cold path polls now.** What neither source sees — a spec edit or merge that reshapes the tree, a
forge issue update — is the genuinely *cold path*: it rides the dashboard's slow fallback poll
([[dashboard-shell]]). The session signals (status, liveness, activity) are all push; the rare,
already-visible-to-its-author tree changes stay on a relaxed timer. The stream also sends a periodic keep-alive
`ping` so an idle proxy never times the connection out, and it never throws: if a source can't start,
subscribers simply fall back to the poll.

**Reconnect is free.** A backend hot-reload replaces the child and drops the stream; `EventSource`
auto-reconnects to the fresh child — the same drop-and-reconnect the live pty bridges already do ([[spec-cli]]),
so a reload self-heals with no client logic. An old backend without this route, or a proxy that strips SSE,
degrades to the fallback poll — never to a stale board.

**Still a full-snapshot refetch.** The push cuts *latency* and *idle* traffic (an untouched board now fetches
nothing, versus a full rebuild every 4s), but each `board-changed` still triggers a whole `/api/board`
refetch — a ~1 MB snapshot on the dogfood board (it scales with the node count), rebuilt from git each time.
The ETag/304 saves the wire but not that rebuild: even an unchanged reload pays the full server-side git read,
so what the push channel really saves is that repeated work, by only fetching on a real change. Shrinking the
payload itself (an incremental/diff board, or folding the changed slice into the event) is a separate, larger
concern tracked as GitHub issue #26, not part of this channel.
