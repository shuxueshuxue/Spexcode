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
record. It is an adapter-local, ephemeral observation of work in progress.

The backend derives a current-turn selector from the newest durable human send, then asks the selected adapter
for exactly one **latest working note** and the normalized tool steps that follow it. The selector is fresh for
each read and never becomes transcript state. An adapter first maps its native user boundary to that selector,
then considers only later native events: a later user boundary clears the projection. It exposes the last
displayable assistant working prose in that slice, skips structured/private reasoning, and attaches only its
following tool steps. TimelineChat renders the note after its durable conversation history, so the current work
is the newest timeline entry. The click opens a transient execution pop-out whose rows retain the adapter's
chronological order, with the newest tool action at the bottom. Its fixed dummy vocabulary is:
`command`, `read`, `write`, `search`, or `tool`, plus `running`/`done`. A row can additionally show one
backend-sanitized detail. Details start collapsed: a compact row shows only its tool, state, and disclosure
control, while expanding that row reveals its own allowlisted detail without opening or changing any sibling.
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
