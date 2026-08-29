---
title: transcript-view
status: active
hue: 280
desc: The one transcript renderer — a closed seam's history and the open seam's live tail are the same normalized payload, drawn by the same components; "live" only adds the truth that a call without a recorded result is still running.
code:
  - packages/transcript-ui/src/TranscriptView.tsx
related:
  - packages/transcript-ui/src/ToolLine.tsx
  - packages/transcript-ui/src/segments.ts
  - packages/transcript-ui/src/vocabulary.ts
  - packages/transcript-ui/src/Quote.tsx
  - packages/transcript-ui/src/render.test.tsx
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/conversationItems.js
---

# transcript-view

SpexCode's [[conversation]] legislated how a transcript reads — the person quoted, the agent as the page, a tool
call as a sentence, the work segment folded behind its answer, output in a quiet well on the page's own ladder —
and this node holds that grammar as ONE set of components in the published package ([[transcript-ui]]),
because two surfaces read the same payload: a closed interval's history, fetched once, and the open interval's
live tail, streamed as the agent works ([[message-stream]]). Both are the normalized turns of [[transcript]], and
both are drawn here — `Quote`, the tool sentence (`ToolLine`), the tool run, the segment fold, `TranscriptView` —
so a change to how a call reads changes it in history and in the tail at once, in every host, and no surface
can drift into its own dialect. Prose is rendered by the host's `renderText`; the words the surface says come
from its `labels`; the verbs and targets from its `vocabulary` ([[transcript-ui]]).

**Live adds exactly one truth.** A tool call whose result the harness has not recorded yet carries no `output`;
a LIVE reading draws that call as running — a small spinner and the word beside the sentence — and a run that
holds a running call is marked so its fold can say it. A closed interval never says running: a stretch that
ended before a result was written is history, not something still happening, so the same payload read as
history draws the same call as a plain sentence.

**A command reads by its head, never by its tool's bare name.** A tool whose input is a bare string is a
command or a script — a codex code-mode `exec` cell, a shell one-liner — and its first non-empty line names it;
a row that says only `exec` hides what ran behind the caret. So a bare-string input shows its first line as the
target (the CSS ellipsis takes the rest of a long line), and the `exec`/`shell`/`wait` tool names carry verbs
(`Ran`, `Waited`) the same way `Bash` does — data rows in the vocabulary, not branches on a harness.

**An MCP call is named by its server and its tool, apart.** Every harness writes an MCP call as
`mcp__<server>__<tool>`; the sentence shows the tool half as its verb (or the vocabulary's verb for that bare
tool name) and the server as a small chip beside it — the data every renderer has and most lose on the screen.
When a call is opened, a JSON argument object is printed one field per line; a bare string (a script, a command)
is shown as itself. The wire form is one line; nobody reads one line of JSON.

**A failure wears the word; success stays silent.** A call whose `outcome` the reader carries
([[transcript-reader]]) ends its sentence with `failed` (or `rejected`, for the call the person refused) from
`labels`, in the same caption register as the running word, and its verb takes the error colour; there is still no
success mark, because the past-tense verb is the whole claim and a mark on every line would say nothing. A folded
run counts its failures on the fold row (`labels.failedCount`) so a failure is never hidden behind "12 tool uses".
The word comes from the transcript's own field, never from the output prose.

**An expanded call shows both sides of the record.** Its original `input` is rendered alongside the recorded
output, so parameters remain inspectable even when a live call has no result yet. A withheld live result still
fetches its body on demand; the input never waits for that fetch.

**The cap is said where it bit.** The reader keeps `outputBytes` at the result's true size while the body it
carries stops at the per-tool cap ([[transcript-reader]]), so the difference is exactly what this call is
missing, and an opened call whose body falls short of its size names the omission (`labels.outputCut`). The read
as a whole already reports its omitted bytes, but that line cannot say WHICH result was cut, and a prefix drawn
with no mark reads as the whole output — the one way a bounded view can lie.

**A result is drawn as text, because this is prose and not a terminal.** Programs print colour, and real
transcripts carry tens of thousands of escape sequences; a `<pre>` renders them as literal debris in the middle
of the sentence someone is reading. They are dropped at the moment of drawing — from the row's target and from
the opened input and output alike — and never from the record, which a terminal surface ([[terminal-ui]]) is
free to read in full. Stripping before the row's length cut matters: cutting first can leave half a sequence
behind. Because the page then holds no escapes, text copied off it is already clean, so there is no separate
copy path. Escapes still count toward the record's size, so removing them from the page must not be read as an
omission.

**The work in progress never folds.** Folding is for process that already produced an answer — collapse the
process, keep the result. The last segment of a LIVE payload is what is happening now: its calls after the newest
prose, or all of its calls while there is no prose yet, draw as sentences whatever their number, in the collapsed
tail and in the expanded interval alike; neither the segment fold nor a turn's own run fold applies to them,
because a `7 tool uses ›` row under a seam line that already says `7 tool uses ›` is a count that shows nothing,
twice. They fold the moment the agent speaks — the prose that follows makes them the process behind that answer
— and a closed interval reads the same calls as history, folded by the ordinary rule. Consecutive tool-only
turns are ONE list of calls: the harness draws a turn boundary around every call it makes, and that boundary is
not a paragraph break, so seven calls in seven turns sit at the same list spacing as seven calls in one.

**A user turn is a boundary, and whether it is also drawn is the host's call** (`userTurns`). In SpexCode every
message is already a row on the record ([[conversation-items]]) — the launch prompt, each `spex session send`,
each peer reply — so a user turn inside a seam's transcript is only a boundary: it marks where a stretch of the
agent's work begins and is never drawn (`boundary`, the default). A host for which the transcript is the whole
conversation quotes it in place (`quote`), with the same bubble the outer conversation uses. The seam renders assistant prose and tool calls alone, with no opener to locate and no text to match. The
two layers never carry the same message, so there is nothing to reconcile and nothing to duplicate — and no
intervening event (a `queued` row, a status note) between the record's message and its seam can defeat a dedup
that no longer exists. A message typed directly into a harness, not through SpexCode, is not part of the
record's conversation and is not surfaced here; the agent's response to it still renders as work. The one text
elision that remains is the live tail's alone — the agent's newest prose against the note it just declared, the
record having drawn that note one row above ([[message-stream]]) — and its `alreadySaid` helper lives here as the
shared text test, used by that one face.

**Disclosure is keyed to the transcript's own ids** — a tool's id, a run's first tool, a segment's first turn —
never to render position, so a live refresh of the same interval keeps what the reader opened, and a payload
for a different interval starts closed by construction.

**Who a quoted turn came from is data.** A message delivered into an agent arrives wrapped in the host's
envelope — addressing for the agent, not what the sender said — and the transcript keeps it verbatim. The
person's turn inside a transcript is therefore read through `envelopes`, an ordered list of parser rows on
`TranscriptUi`: each row turns the text into the sender it names and the bare body, or declines; the first match
is quoted with that name, an unmatched turn is quoted whole from nobody. SpexCode's own row — the footer
`spex session send` appends — ships as the default and is the same row the outer conversation strips with, so
the two surfaces cannot disagree about one format; a host with its own wrapper (an XML delivery tag, a bracketed
header) registers one more row and never teaches the renderer the shape. The envelope's context lines (how to
reply, routing) are for the agent and are not drawn.
