---
title: transcript-reader
status: active
hue: 205
desc: The one native-thread reader — a per-harness parser behind a cheap revision probe and a bounded, interval-addressed read that returns normalized turns for every surface that shows what the agent did.
code:
  - spec-cli/src/transcript-reader.ts
related:
  - spec-cli/src/transcript-reader.test.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/session-transcript.ts
  - spec-dashboard/src/TimelineChat.jsx
---

# transcript-reader

Every harness keeps its conversation somewhere private — Claude Code's project JSONL, Codex's rollout, pi's
session JSONL, OpenCode's store behind `opencode export` (read raw: the `--sanitize` form replaces every prose and
tool-output part with a redaction token and leaves nothing to read). The [[harness-adapter]] exposes ONE field for
all of it, `transcript`, and this module is the only code that knows those shapes. It answers exactly one question
for any harness: *what happened in this thread between `from` and `to`?* — as a small normalized turn stream:
user and assistant prose, tool calls with their input, and each call's output once the harness recorded it. The
history seam, the live tail, and the transcript stream ([[session-transcript]]) all read through this seam, so a
harness has exactly one parser, and adding a harness adds one parser, never one per surface. Native envelopes,
runtime state, tmux panes, and transcript paths do not cross the adapter boundary; structured or private
reasoning is never a turn.

**The reader has three verbs.** `revision(threadId)` is the cheap change probe — a file stat for the JSONL
harnesses, the store's database/write-ahead-log stat for OpenCode — and is `null` when the source does not exist
yet, so a subscriber can tick without parsing and a thread that has not started writing reads as absent rather
than broken. `read(threadId, {from, to})` is the bounded interval read; its result carries the revision it was read
at. `tail(threadId, from)` opens a cursor on the OPEN interval `[from, now]`: each `advance(to)` parses only what
the harness appended since the last one — a native file only grows, so the cursor keeps its byte position and the
line still being written — and returns the same complete snapshot `read` would; a source that shrank was
rewritten underneath it and is read afresh, and a tail opened before the thread exists fails as `missing` on
advance, not at construction. OpenCode has no growing file, so its tail re-collects from the export cached per
revision. A harness with no reliable native transcript (z-code) declares `unsupportedTranscript`, whose read and
tail fail with an explicit `unsupported` reason and whose revision is always `null`; it never pretends the
conversation was empty. The four headless adapters inherit their base harness's reader, because the thread is
the same file.

**Every turn is keyed.** A turn carries the harness's own id when it has one, else `<role>@<at>` — `#n` appended
for the n-th turn sharing that clock — assigned in thread order, which an append-only source keeps stable across
re-reads. That is what lets [[session-transcript]] send only the turns that changed and a subscriber match them
to the ones it holds.

**Bounded, and honest about the bound.** The read caps turns and per-tool output bytes and reports `truncated`,
`omittedTurns`, `omittedBytes`, and `outOfOrderEvents` whenever payload was omitted or the native timestamp
order crosses back into or before the requested range. The turn cap keeps the NEWEST turns — a live tail and a
closed stretch are both read for what happened last. Every tool result in one native event is matched
independently; a result whose call lies outside the interval, or whose call was dropped by the cap, is counted as
omitted bytes rather than silently represented as an empty result. A call whose result has not been recorded has
no `output` field at all — that absence is what a live surface reads as "still running". After passing `to`,
a line reader scans a fixed lookahead window for timestamp disorder before stopping, so a cold tail stays
bounded.

**An open interval re-reads cheaply.** A native file is append-only, so the byte where an interval's first
event sits never moves; the reader remembers that offset per (file, `from`) and a one-shot read of the same
interval starts there, while the tail cursor goes further and parses only the bytes appended since its last
advance — the open interval is never "parse the whole stretch again", let alone the whole thread. OpenCode has
no per-thread file: one export per store revision is parsed and kept, so repeated reads of a quiet thread
export nothing new.

A missing, deleted, unreadable, malformed, or timestamp-less native source is an explicit `missing`, `unreadable`,
or `invalid` failure. The transcript remains a payload, never a field in `timeline.ndjson` or `runtime.json`.
