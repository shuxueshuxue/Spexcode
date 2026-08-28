---
title: session-transcript
status: active
hue: 205
desc: The session-addressed face of the transcript reader — one resolver from a governed session to its native thread, a bounded GET for a closed interval, and an SSE for the open interval the agent is working in.
code:
  - spec-cli/src/session-transcript.ts
related:
  - spec-cli/src/session-transcript.api.test.ts
  - spec-cli/src/index.ts
  - packages/transcript/src/frames.ts
  - packages/transcript/src/readers.ts
  - spec-dashboard/src/data.js
  - spec-dashboard/src/data.test.mjs
---

# session-transcript

[[transcript-reader]] answers for a native thread; this module addresses it by session. One resolver turns a
governed session id into its adapter and exact native thread identity (`exactNativeTargetId`) — an unknown or
unmanaged session is a 404, a record without a native identity yet is a 409, and native bytes never cross here:
the adapter's reader hands back normalized turns and these routes only address them. Nothing is persisted; no
event is ever appended to `timeline.ndjson`.

`GET /api/sessions/:id/transcript?from=<ms>&to=<ms>` reads a CLOSED interval. Both bounds are required finite
integer epoch milliseconds with `from < to` (400 otherwise), so the route never guesses which stretch the caller
intended. A read failure keeps the reader's reason: `unsupported` is 501, `invalid` is 422, `missing` and
`unreadable` are 409.

`GET /api/sessions/:id/transcript/stream?from=<ms>` is the OPEN interval `[from, now]` — the stretch a working
agent is in right now, whose end is the server clock and moves — carried over SSE. What a frame holds, when one
is worth sending, and how the subscriber merges it is the frame protocol ([[transcript-frames]], the wire's one
home; this route and the dashboard both import it and neither restates it). This route owns only the carriage:
it opens `openFrameStream` on the adapter's reader, publishes immediately, then asks the stream to publish each
tick and writes one `transcript` SSE event per frame it yields — the first the whole interval (`full`), every
later one a `delta` — so a subscriber holds one consistent read of the same shape the GET returns and one
renderer reads both. A reconnect or a restarted server starts from `full` again. Periodic `ping` heartbeats let
the browser's dead-man reopen a silent stream. Reading happens only while a client is subscribed and stops on
abort, closing the cursor.

**A live frame carries no output bodies** ([[transcript-frames]]): a recorded result travels as `output: null`
with its true `outputLines`/`outputBytes`; a running call has no `output` field. The body comes from
`GET /api/sessions/:id/transcript/tool/:toolId?from=<ms>` — the same interval, one call, `{id, output,
outputLines, outputBytes}`, 404 when the call is not in it — read once, when a person opens the call. The
closed-interval GET keeps bodies inline: it is read once for its history.

The compact execution projection this replaced — a separate route that parsed the same native file a second
way into "the latest working note and its steps" — no longer exists: the browser derives the current turn from
the streamed turns ([[message-stream]]), so one parser, one transport, one payload serve the seam's history,
its live tail, and its expanded view alike.
