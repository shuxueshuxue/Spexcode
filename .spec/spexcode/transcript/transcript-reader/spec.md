---
title: transcript-reader
status: active
hue: 205
desc: The one native-thread reader — a per-harness parser behind a cheap revision probe and a bounded, interval-addressed read that returns normalized turns for every surface that shows what the agent did.
code:
  - packages/transcript/src/readers.ts
related:
  - packages/transcript/src/readers.test.ts
  - packages/transcript/src/parsers.ts
  - packages/transcript/src/turns.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/session-transcript.ts
  - spec-dashboard/src/TimelineChat.jsx
---

# transcript-reader

Every harness keeps its conversation somewhere private — Claude Code's project JSONL, Codex's rollout, pi's
session JSONL, Gemini's project session JSONL, OpenClaw's per-agent session JSONL, Hermes's SQLite-backed session
export, and OpenCode's store behind `opencode export` (read raw: the `--sanitize` form replaces every prose and
tool-output part with a redaction token and leaves nothing to read). The [[harness-adapter]] exposes ONE field for
all of it, `transcript`. The parsers beside this module ([[transcript]]'s `parsers.ts`) are the only code that
knows those seven native shapes — one parser per harness, shared with the in-memory source ([[live-transcript]]) — and this
module is the only code that knows WHERE each harness keeps the thread. It answers exactly one question
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

Live app-server sources may re-emit a native id while an item streams; the shared collector replaces that turn in
place and preserves its tool calls. Native thread files do not re-emit ids, so file readers remain ordinary
append-only scans with the same normalized result.

**Bounded, and honest about the bound.** The read caps turns and per-tool output bytes and reports `truncated`,
`omittedTurns`, `omittedBytes`, and `outOfOrderEvents` whenever payload was omitted or the native timestamp
order crosses back into or before the requested range. The turn cap keeps the NEWEST turns — a live tail and a
closed stretch are both read for what happened last. Every tool result in one native event is matched
independently; a result whose call lies outside the interval, or whose call was dropped by the cap, is counted as
omitted bytes rather than silently represented as an empty result. A call whose result has not been recorded has
no `output` field at all — that absence is what a live surface reads as "still running". After passing `to`,
a line reader scans a fixed lookahead window for timestamp disorder before stopping, so a cold tail stays
bounded.

**A code-mode command is normalized to what ran, not how it was reached.** Codex's code-mode `exec` tool
carries a JS program as its input — `const r = await tools.exec_command({cmd:"…"}); text(r.output)` — where the
shell command is the content and the JS around it is transport the model writes to reach the sandbox. The codex
adapter extracts the `cmd` string(s) (unescaped; a batch of several joins one per line) and hands them up as the
tool's input, so every surface shows the command that ran and never the wrapper. This is codex-specific knowledge
and it lives here, at the bottom of the stack in the codex parser — the normalized `TranscriptTool` is
harness-agnostic, so the shared vocabulary and the renderer never learn a code-mode literal exists. A cell that
calls no `exec_command` is left untouched.

**A result is what the tool said, not its wire shape.** A harness that records a result as content blocks —
Claude's `tool_result.content` list, Codex 0.146's `input_text` output blocks, an MCP result's `content[]`
anywhere — means the text of those blocks with their line breaks, joined; the reader never encodes the block list
itself, which would show a person escaped newlines inside a JSON shell. A block that is not text (an image, a
reference) is named in brackets, not dumped.

**How a call ended is the harness's verdict, not the reader's reading.** A call carries `outcome: failed` or
`outcome: rejected` only when the native record says so in a structured field — Claude's `tool_result.is_error`,
pi's and OpenClaw's `toolResult.isError`, OpenCode's `state.status: error`, Gemini's call `status: error`, and
the Codex app-server item status (`failed`; `declined` is `rejected`, the call the person refused, which never ran
and so ends with an empty result rather than reading as running forever). Absent means the harness recorded no
such signal — a Codex rollout carries none, and Hermes writes nothing — never "succeeded". The reader does not
sniff the output prose for the words "error" or "denied": that is the adapter seam where every independent Claude
adapter has silently dropped the field, and a text guess would be wrong in both directions. A renderer therefore
has one honest signal to show ([[transcript-view]]), and a fold cannot hide a failure behind a count.

**A stopped call has no structured home in any harness we read, so `outcome` has no third value.** The natural
third answer — the call a stop ended mid-flight, neither failed nor succeeded — is asked for often enough that
the reason it is absent belongs here rather than being rediscovered. No adapter emits it per call. OpenCode's
`ToolState` union is Pending/Running/Completed/Error with no cancelled member; Claude records an interruption as
prose (`[Request interrupted by user]`) in message content, which this reader does not sniff by the rule above;
pi, OpenClaw, Gemini and Hermes carry only their error field. Codex does record the stop, but one scope up: the
app-server's `turn/completed` reports `turn.status: interrupted` for the whole turn, a fact about the run rather
than about any one call. Adding a per-call value now would define a vocabulary nothing fills, and inferring one
from a call that merely has no result would re-invent the text guess in a new costume — a tool still running when
the reader looked is indistinguishable from one a stop ended. If the turn-level fact is ever wanted on the page it
enters at its own scope, from that field, and only once a producer delivers it unfolded.

**An open interval re-reads cheaply.** A native file is append-only, so the byte where an interval's first
event sits never moves; the reader remembers that offset per (file, `from`) and a one-shot read of the same
interval starts there, while the tail cursor goes further and parses only the bytes appended since its last
advance — the open interval is never "parse the whole stretch again", let alone the whole thread. OpenCode has
no per-thread file: one export per store revision is parsed and kept, so repeated reads of a quiet thread
export nothing new.

A missing, deleted, unreadable, malformed, or timestamp-less native source is an explicit `missing`, `unreadable`,
or `invalid` failure. Gemini's locator searches `GEMINI_HOME`/`GEMINI_CONFIG_DIR` (default `~/.gemini`) for the
session id; OpenClaw searches `OPENCLAW_STATE_DIR` (default `~/.openclaw/state`) for its per-agent JSONL. Hermes
uses the profile's `state.db` stat as its revision and invokes `hermes sessions export --format jsonl --session-id
<id> --yes`, with `SPEXCODE_HERMES_CMD` as the command override and `HERMES_HOME` selecting the profile root. The
captured fixtures verify Gemini `gemini` records and `$set.messages`, OpenClaw `message` records with `toolCall` /
`toolResult`, and Hermes's `messages` array with OpenAI-style `tool_calls`; other native record variants are
`unverified` rather than inferred. The transcript remains a payload, never a field in `timeline.ndjson` or
`runtime.json`.

**A closed Codex thread is still readable.** Codex archives a thread's rollout when the thread is archived — the
app-server's `thread/archive`, which a closed session runs — moving it out of `sessions/YYYY/MM/DD/` into the flat
`archived_sessions/` beside it. The locator looks there second, so a session that has finished and been closed
does not read as `missing` while its conversation is on disk; measured on a real eight-lane run whose transcripts
all answered `missing` the moment the lanes were closed.

**A steered message is a user turn.** Claude does not record a message injected into a RUNNING turn (stream-json
`type:user` on the controller's stdin, a queued command in the TUI) as a `user` message; it writes an
`attachment` record of type `queued_command` carrying the prompt blocks. The parser reads that as the person's
turn at the moment it entered the conversation — the one place a steer becomes observable, since no hook fires
for it (gugu#636) — so a live surface shows the steer between the calls it fell between, and a status derived
from the transcript sees it. Other attachments (tool listings, reminders) are not turns. Measured on a real
claude-headless session steered mid-count (bench 3.6): before this, the transcript showed the agent stopping
for no visible reason.

**Codex 0.146 says everything twice; the reader says it once.** A current rollout records the person's message
as the `user_message` event AND as a `response_item` message (the API form, `input_text` blocks — beside harness
injections no person typed, such as the AGENTS.md instructions), and the agent's prose as the `agent_message`
event AND as a `response_item` message (`output_text` blocks). The reader takes the events — one user turn per
message, one assistant turn per reply — and reads neither `response_item` message form as a turn; an empty
`agent_message` (a final answer that was a tool call) is a clock, not a turn. Measured on bench 3.9: before this,
every human message appeared twice, once as a JSON-encoded block array.
