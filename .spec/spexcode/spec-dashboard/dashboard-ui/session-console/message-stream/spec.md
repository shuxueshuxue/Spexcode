---
title: message-stream
status: active
hue: 280
desc: The latest harness working note is a compact entry into a live, backend-normalized execution trace; TimelineChat never reads or parses a native transcript.
code:
  - spec-dashboard/src/ExecutionTrace.jsx
related:
  - spec-cli/src/execution-trace.ts
  - spec-cli/src/session-execution.ts
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/execution-trace.e2e.mjs
---

# message-stream

`TimelineChat` remains the session's durable conversation: [[session-timeline]] is still the only record of
what was said and declared. A harness transcript is neither a second conversation nor a durable SpexCode
record. It is an adapter-local observation: the live execution trace is ephemeral, while a status disclosure may
read a bounded native transcript payload from disk on demand. That payload is never copied into the session record
or timeline.

The backend derives a current-turn selector from the newest durable human send, then asks the selected adapter
for exactly one **latest working note** and the normalized tool steps that follow it. The selector is fresh for
each read and never becomes transcript state. An adapter first maps its native user boundary to that selector,
then considers only later native events: a later user boundary clears the projection. It exposes the last
displayable assistant working prose in that slice, skips structured/private reasoning, and attaches only its
following tool steps. TimelineChat renders the note after its durable conversation history, so the current work
is the newest timeline entry — and it renders it AS CONVERSATION, the LIVE TAIL, never as a card with a door.
The old entry was a dashed, tinted, one-line button that opened a pop-out: the one piece of chrome on a page
whose whole grammar is that the turns carry their own structure ([[conversation]]), and it ellipsed the very
sentence it existed to show. Now the working note is agent prose at the prose size, sitting on the page, and
each tool step beneath it is the transcript's own tool sentence — the same `.tc-tool` row the folded history
reads in — so the live tail and the history are one flow. Rows keep the adapter's chronological order with
the newest action at the bottom. The fixed vocabulary is `command`, `read`, `write`, `search`, or `tool`,
plus `running`/`done`: a running step wears a small spinner and the word, a done step wears nothing, because
a finished sentence is its own mark. A row can additionally show one backend-sanitized detail. Details start
collapsed: a compact row shows only its kind, its label, its state, and its disclosure caret, while expanding
that row (`aria-expanded`) reveals its own allowlisted detail inline without opening or changing any sibling.
A same-turn live revision retains expanded rows whatever it revised — a later note, a finished step; only a
changed displayed turn (or a changed session) starts disclosure closed.

**The tail says nothing the record already said.** The working note is the agent's newest prose in the turn;
the moment the agent declares that same prose as its status note, the durable timeline draws it as a message
one row above, and the same sentence twice — once as history, once as "now" — is the duplication a reader
notices first. So the note is elided when the newest agent message on the record already carries it (either
side may be the other's prefix, since the backend clips a note at 240 characters), and a tail whose note is
elided and whose steps are all done draws nothing: the record has the words and the seam has the history.

**What reads as live is a caret and a spinner, nothing more.** While the session is `working` the note ends in
a blinking caret; a running step spins; a new revision fades in. Reduced motion stills all three. And the
instant the trace empties — the turn settled — the timeline is asked to refresh at once rather than at its
next poll, so the declared note lands where the live note just was, which is what makes a transcript-fed page
feel like a streaming agent.
The renderer never knows a harness id, transcript path, envelope schema, raw tool arguments, tool result, or
reasoning text. Its only job is to paint the backend's small projection and choose a familiar icon for the given
kind.

The phrase "latest" is literal: a later displayable working note replaces the prior note and its steps. Earlier
commentary, prior turns, structured reasoning, tool arguments/results, and every other transcript field stay
private. A source that cannot be read or whose current selector does not yet map to a native user boundary has no
entry, rather than displaying a partial raw transcript or an invented error conversation.

`GET /api/sessions/:id/execution` returns the current compact projection. Its companion
`GET /api/sessions/:id/execution/stream` writes that same projection once, then sends only changed revisions
and periodic heartbeats. Reading happens only while a client is subscribed and stops on disconnect. The SSE is
an update transport, not a second persistence layer: no event is appended to `timeline.ndjson`, no browser
polls native files, and reconnect simply receives a fresh projection. The browser's existing heartbeat
dead-man treats a silent stream as dropped and reopens it, so a half-open proxy cannot leave a visible note
stuck. A non-governed or unknown session is a 404 on both routes.

Pane-backed adapters keep their real terminal as the full live surface. This compact trace is additive to the
Conversation surface, never a raw-process door or an alternate terminal.

Status entries may disclose their bounded transcript interval lazily. Loading and unavailable states are visible,
the result is cached per session, and tool rows stay collapsed until a second action discloses their output.
