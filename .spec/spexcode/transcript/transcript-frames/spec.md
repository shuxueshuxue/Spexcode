---
title: transcript-frames
status: active
hue: 205
desc: The transport-neutral frame protocol for an open transcript interval — a full frame once, then deltas keyed by turn id, output bodies withheld — with the producer and the subscriber's merge in one module.
code:
  - packages/transcript/src/frames.ts
related:
  - packages/transcript/src/frames.test.ts
  - packages/transcript/src/turns.ts
  - spec-cli/src/session-transcript.ts
  - spec-dashboard/src/data.js
---
# transcript-frames

An agent is working in the OPEN interval `[from, now]` — the stretch whose end is the clock and moves. This module
is what a subscriber to that interval receives and how it merges it, written once for both ends: the producer
(a server tick, an Electron main process) and the consumer (a browser, a renderer) import the same code, and the
module imports nothing from Node so the `./frames` entry of [[transcript]] can reach a bundle. Transport is not
decided here: SpexCode carries frames over SSE ([[session-transcript]]), another adopter over IPC, and both
forward what `openFrameStream` yields, byte for byte.

**A frame is what changed.** The first frame on a stream is the whole interval (`kind: "full"`); every later one
is a `delta` holding only the turns that are new or changed since the previous frame — a turn changes when a
call in it gains its result — and, as `removed`, the ids the turn cap evicted. `truncated` and the omission
counters are always absolute. The subscriber merges by turn id (`mergeTranscriptFrame`: replace a held turn,
append an unknown one, drop the removed, keep arrival order because the native thread is append-only) and holds
one complete read of the same shape a closed-interval read returns, so nothing downstream knows the wire is
incremental; the wire's `kind` never reaches the renderer. A frame without a kind (a closed read, an older
server) is read whole. An error frame `{revision, from, to, error, reason}` passes through untouched and leaves
the held turns as they were, so a surface can say so in place.

**A live frame carries no output bodies.** A call whose result the harness recorded travels with `output: null`
and its true `outputLines`/`outputBytes`; a call with no result has no `output` field at all, which is what a
surface reads as running. The body is fetched once, when a person opens the call, through whatever the adopter's
transport offers for it. Measured on a real 29-minute turn (92 turns, 33 calls), the whole-payload frame was
320 KB — 74% tool output, 20% tool input, 0.3% prose — re-sent on every native write; the delta makes a change
cost what changed, and withholding bodies makes even the first frame the size of what is on screen.

**`openFrameStream(reader, threadId, from)` is the producer.** `publish()` runs the reader's cheap revision
probe and returns `null` unless the revision moved; when it did, it advances the interval's cursor (the reader
parses only what was appended) and returns the frame that read is worth — or `null` again when the read changed
nothing the subscriber holds. An absent source (revision `null`) is an empty `full` frame with the revision
`absent`, never an error, and it resets the producer so the next real read is `full` again; a `TranscriptReadError`
becomes an error frame, any other failure propagates. Call `publish` on a tick for a file-backed reader or on a
change notification for an in-memory one ([[live-transcript]]): the frames are identical, and the stream does not
know which reader it was given. `FrameProducer` is the diffing half alone, for a producer that owns its own
reads.
