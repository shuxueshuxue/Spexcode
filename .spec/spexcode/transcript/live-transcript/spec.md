---
title: live-transcript
status: active
hue: 205
desc: The in-memory transcript source — native events a headless controller already holds, pushed through the same per-harness parser, read through the same reader verbs, with a change notification instead of a tick.
code:
  - packages/transcript/src/live.ts
related:
  - packages/transcript/src/live.test.ts
  - packages/transcript/src/parsers.ts
  - spec-cli/src/claude-headless.ts
---
# live-transcript

A headless controller watches the harness's native events stream past — Claude's `--output-format stream-json`
lines, which are exactly the records its project JSONL holds; an app-server's notifications — so a transcript
need not be re-read from the file the harness is also writing, and a message steered into the current turn is
seen the moment the harness echoes it. `LiveTranscript` is that source: push each native record through the
parser the file reader uses for the same harness ([[transcript]]'s `parsers.ts`), and it is a `TranscriptReader`
like any other — the interval `read`, the incremental `tail`, and the frame protocol ([[transcript-frames]]) work
unchanged, and no consumer learns whether its turns came from a file or from memory. That equivalence is the
point: one renderer, one wire, two producers.

**One instance is one thread.** It is constructed with the parser and the thread id it holds; a reader verb
addressed to another thread fails as `missing` rather than answering for the wrong conversation. `revision` is
`null` until the first recognized event lands — the thread has not started, which the frame protocol reads as
absent — and afterwards a write counter, so a producer can tick cheaply; `onChange` hands a producer the
alternative to ticking: publish on arrival. `push` returns whether the record meant anything to the parser; a
native stream carries plenty the transcript does not show (control replies, usage, the result envelope), and an
unrecognized record is not an error.

**Parsed events are never written to.** The interval collector works on its own copy of every turn and its
calls, because this source collects the same events again on every read — the file reader re-parses bytes and
never noticed, but a collector that appended a result onto the parsed tool object would show `okok` on the
second read. The tail is an index into the event list: each advance collects only what was pushed since the last
one and returns the same snapshot `read` would.
