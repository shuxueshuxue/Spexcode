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
reference) is named in brackets, not dumped — and named with what the producer said about it: the media type
when the record states one (Claude's `source.media_type`, the `data:<mime>;` prefix of Codex's `image_url`) and
the size, which base64 always yields. Neither is guessed; a picture whose type the producer never stated is
`[image 1.2 MB]`, not sniffed from its bytes. On the threads on this box that turns 189 identical `[image]`
into `[image/png 105 KB]`, `[image/jpeg 464 KB]`, and so on.

**The output is text, and a picture does not fit in it — that is a decision, not an omission.** Carrying blocks
as bytes was considered and is not done. The result is capped at 64 KB per call, which a single screenshot
exceeds, so a block array would either truncate images into garbage or abandon the cap that keeps a read
bounded. The live path already answers the real need a different way: a frame withholds result bodies and the
host fetches one on demand ([[transcript-frames]]), so a surface that wants the picture has a seam to ask
through. What the reader owes is an honest account of what was there, which the named placeholder gives.

**How a call ended is the harness's verdict, not the reader's reading.** A call carries `outcome: failed` or
`outcome: rejected` only when the native record says so in a structured field — Claude's `tool_result.is_error`,
pi's and OpenClaw's `toolResult.isError`, OpenCode's `state.status: error`, Gemini's call `status: error`, and
the Codex app-server item status (`failed`; `declined` is `rejected`, the call the person refused, which never ran
and so ends with an empty result rather than reading as running forever). Absent means the harness recorded no
such signal — Hermes writes nothing — never "succeeded". The reader does not
sniff the output prose for the words "error" or "denied": that is the adapter seam where every independent Claude
adapter has silently dropped the field, and a text guess would be wrong in both directions. A renderer therefore
has one honest signal to show ([[transcript-view]]), and a fold cannot hide a failure behind a count.

**One harness keeps the verdict in a third record, so reading it is a second join.** A Codex rollout's result
item carries no failure field at all — `function_call_output` and `custom_tool_call_output` hold only a
`call_id` and an `output`. The harness records how the command ended in a separate `event_msg` addressed by
that same `call_id`: `exec_command_end.status` (`completed` | `failed`) and `patch_apply_end.success`. The
reader therefore emits the outcome on its own, with no text, so it lands on the call the output record already
filled — the same id-addressed mechanism that joins a result to its call, used a second time. Skipping it is
not a small omission: on the rollouts on this box the failed status is on disk 6,194 times and none of it
reached the page.

**A signal is not a record.** `stopReason: aborted` is written when the agent's own runtime cancels a turn —
pi's extension abort path — and NOT when the process is killed: measured on the pi lane, a default SIGINT or
SIGTERM death writes no line at all, so the turn simply stops mid-file with no verdict. The vocabulary is
therefore narrower than the enum suggests, and the reader must keep treating a turn with no outcome as a turn
with no signal rather than inferring one from where the file ends. A separate consequence for locators: pi's
`--session-dir` flattens the session layout the default root implies, so a thread started that way is not
found by the path this reader walks. That is the locator's contract holding, not failing — but it is a real
way to hand the reader a thread it cannot see.

**A stop is recorded on the TURN, not on the call — so that is where it is carried.** No harness we read marks
a single call cancelled: OpenCode's `ToolState` union is Pending/Running/Completed/Error with no cancelled
member, Claude writes an interruption as prose (`[Request interrupted by user]`) which the rule above forbids
sniffing, and Gemini and Hermes carry no such field at all. Two producers do record it, both one scope up. pi
and OpenClaw write `stopReason` on the assistant message — `StopReason = "stop" | "length" | "toolUse" |
"error" | "aborted"` in pi's shipped types — with an `errorMessage` beside it; Codex's app-server reports
`turn.status: interrupted` on `turn/completed`. So a turn carries `outcome: failed | cancelled` and the
producer's own `error` text, and a call does not: `TranscriptTool.outcome` has no third value, because
inventing one would define a vocabulary nothing fills and inferring it from a call that merely has no result
would re-invent the text guess — a tool still running when the reader looked is indistinguishable from one a
stop ended.

**A failed turn is the one that most needs drawing, and it is the emptiest.** Every pi turn whose `stopReason`
is `error` or `aborted` carries no text and no calls — 13 of 578 assistant messages in the sessions on this
box, every one of them. A reader that keeps only turns with something in them therefore drops exactly the
turns a person is looking for, and the page shows a silent gap where a timeout or an interrupt happened. The
turn is emitted with its outcome and, when the producer wrote one, its own words for it.

**The app-server's tool calls are the variants its own union declares.** Its `ThreadItem` union is the
authority on what a call is, and reading a variant list off the rollout's record types instead put two names in
the set (`functionCall`, `customToolCall`) that the app-server never emits, while leaving out `fileChange` — so
a Codex file edit arrived as no call at all. Each variant also keeps its result in its own field: a command's
`aggregatedOutput`, a dynamic call's `contentItems`, a file change's per-path `diff`, and an MCP call's
`result.content` — that last one is a wrapper (`{content, structuredContent, _meta}`), and handing the wrapper
to the block reader printed the envelope rather than what the tool said.

**A turn is the harness's unit, not the file's line.** Claude writes one CONTENT BLOCK per line — prose on
one, each call on its own — and every line of the same API message repeats that message's `id` while carrying
its own `uuid`. Keying a turn on the line made one message up to six turns: over twelve recent threads, 5,077
assistant lines carry only 2,396 distinct message ids. The cost is not cosmetic, because the read is bounded
by TURNS: on one real hour of one real thread the fragmented read filled its 200-turn cap, reported
`truncated`, and dropped 38 turns and 22 calls, while the same hour keyed on the message is 148 turns and
loses nothing. The fragments are folded back by the rule the collector already has for a re-emitted turn —
prose kept, calls merged by their own ids — so no parser accumulates state to do it.

**Which enum values exist is not which values are produced.** A protocol or a type declaring a state proves
only that the state can be expressed. ACP's `ToolCallStatus` includes `Cancelled` and Zed keeps a local
`Canceled`, and neither is evidence that any harness writes one into a transcript — Zed's, by its own design,
never leaves the editor. A field this reader fills has to be counted in real records before it earns a place
in the vocabulary, which is why the per-call `cancelled` above stays absent while the turn-level outcome, with
two producers that do write it, does not.

**A store is a row, and a root is a parameter of every reader.** Two harnesses keep no per-thread file: a
thread is obtained by running the harness's own export command, and the change token is the store's files. That
is one reader with a row per store — which files make the token, what the export command is, which parser reads
its document — not two copies. The copy is what let one of them watch a write-ahead log the other never did,
and that is not a cosmetic difference: in WAL mode a plain commit leaves the database file's size and mtime
untouched, so a token watching only the database is frozen and the cached export is served forever. The
database's own absence is what "no store" means; a missing log is a checkpointed store, not a missing one.
Symmetrically, every reader takes a root, because every locator already did — only the store readers exposed
it, so a second root for any file harness could not be asked for at all. Passing nothing keeps the locator's
own default evaluated per call, so a late environment change is still picked up.

**A thread that has not spoken yet is not a broken one.** A harness creates the file before it writes its
first record and then opens with bookkeeping: every Claude transcript begins with clockless `mode`,
`permission-mode` and `file-history-snapshot` lines before its first message — 40 of 40 real threads on this
box. So the first moments of every new session are zero bytes, then lines this parser does not recognize at
all. Both read as an empty transcript: no turns, nothing truncated, and the revision still moves the instant
the first message lands. The clock gate is about the HARNESS, not the moment — it fires when a record this
parser DID recognize carries no usable time, because that is what makes interval reads impossible; a file in
which nothing is JSON at all is still loud, since that is not this thread's transcript. Failing on the opening
instead put an error frame on the page for exactly the seconds someone watches a new task, and for exactly the
window a spawn probe samples.

**One unreadable line is omitted payload, not an unreadable transcript.** A native log is written by another
process and can carry a line that is not JSON — a record torn off by a crash, something appended by hand. Its
bytes are counted as omitted and the read reports `truncated`, exactly as it does for a result past the cap;
the conversation around it is still returned. Throwing instead is the loudest possible failure and the least
useful one, because it costs the person a whole thread over one line — measured on a real rollout on this box,
a single 17-byte torn line made all five of its turns unreadable. Loudness is still where it belongs: a file
that is not this format at all parses nothing, never sees a timestamp, and fails `invalid` on that gate.

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
