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
  - spec-cli/src/transcript-reader.ts
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
agent is in right now, whose end is the server clock and moves. The stream writes one frame immediately, then
each tick runs the adapter's cheap revision probe and, only when the revision moved, advances the interval's
cursor ([[transcript-reader]] parses only what was appended) and pushes what CHANGED as one `transcript` event.
**The first frame is the whole interval (`kind: "full"`); every later one is a `delta`** holding only the turns
that are new or changed since the previous frame — a turn changes when a call in it gains its result — and, as
`removed`, the ids the turn cap evicted; `truncated` and the omission counters are always absolute. The
subscriber merges by turn id and holds one consistent read of the same shape the GET returns, so one renderer
reads both; a revision that moved without changing the interval sends nothing. A reconnect or a restarted server
starts from `full` again. An absent source is an empty `full` frame with the revision `absent` — the thread has
not started writing — not an error; a read failure is a frame carrying `{error, reason}` so the surface can say
so in place. Periodic `ping` heartbeats let the browser's dead-man reopen a silent stream. Reading happens only
while a client is subscribed and stops on abort, closing the cursor.

**A live frame carries no output bodies.** A call whose result the harness recorded travels with `output: null`
and its true `outputLines`/`outputBytes`; a call with no result has no `output` field at all, which is what the
surface reads as running. The body comes from `GET /api/sessions/:id/transcript/tool/:toolId?from=<ms>` — the
same interval, one call, `{id, output, outputLines, outputBytes}`, 404 when the call is not in it — read once,
when a person opens the call. The closed-interval GET keeps bodies inline: it is read once for its history.

Why both: measured on a real 29-minute turn (92 turns, 33 calls), the whole-payload frame was 320 KB — 74% tool
output, 20% tool input, 0.3% prose — and it was re-sent on every native write, so a minute of ordinary tool use
cost megabytes per open tab for a surface that shows one line per call and a body only on click. The delta makes
a change cost what changed; withholding bodies makes even the first frame the size of what is on screen.

The compact execution projection this replaced — a separate route that parsed the same native file a second
way into "the latest working note and its steps" — no longer exists: the browser derives the current turn from
the streamed turns ([[message-stream]]), so one parser, one transport, one payload serve the seam's history,
its live tail, and its expanded view alike.
