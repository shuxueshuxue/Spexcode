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

**One event source, all subscribers.** A single `fs.watch` on the per-user session store
([[runtime]]) is the whole event source: every status transition lands as a write to
`sessions/<id>/session.json` (the harness hooks author it), so a record write *is* the board-changed signal
for the hot path — the session status and grouping the poll made feel slow. The watch is recursive (a new
session is a new subdir) and lazily started on the first subscriber; a burst of writes (a merge or launch
touches several records) is debounced into one signal fanned out to every open stream.

**Hot path pushed, cold path polled.** Only session-store changes are watched. Changes this watcher does not
see — a spec edit or merge that reshapes the tree, a forge issue update — are the *cold path*: they ride the
dashboard's slow fallback poll ([[dashboard-shell]]), not a second watcher. That split is deliberate: the
laggy-feeling thing (session status) gets the instant push; the rare, already-visible-to-its-author things
stay on a relaxed timer. The stream also sends a periodic keep-alive `ping` so an idle proxy never times the
connection out, and it never throws: if the watch can't start, subscribers simply fall back to the poll.

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
