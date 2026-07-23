---
title: message-stream
hue: 280
desc: The console data plane for headless harnesses: full native-event history over REST, append-follow over SSE, and a chat-shaped desktop view with no fake terminal.
code:
  - spec-dashboard/src/SessionMessages.jsx
related:
  - spec-cli/src/message-stream.ts
  - spec-cli/src/message-stream.test.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/messageStream.js
  - spec-dashboard/src/messageStream.test.mjs
  - spec-dashboard/test/message-stream.e2e.mjs
  - spec-dashboard/src/data.js
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---

# message-stream

A headless harness owns no terminal pane. Its console truth is the harness-native stream already persisted by
the adapter as one JSON event per appended line in the session's global `messages.ndjson`. SpexCode consumes
that file contract without importing adapter definitions, synthesizing terminal state, or teaching the backend
the native event schema.

The backend exposes two reads below `/api/sessions/:id`: `GET /messages` returns every complete NDJSON event in
file order plus the byte cursor immediately after the last complete line, while `GET /messages/stream` is an
SSE append-follow beginning at `?cursor=` or the reconnecting client's `Last-Event-ID`. Each appended event is
one SSE `message` frame whose id is its next byte cursor. The stream watches file creation and append in the
session store, sends a transport-only heartbeat, and never polls the whole session board. A known session whose
adapter has not created the file yet reads as an empty stream; an unknown session is 404; malformed complete
NDJSON fails loudly instead of disappearing. An unterminated tail stays unread until its newline lands.

The dashboard selects this console from a small harness-id data registry; the first row is `claude-headless`.
All pane-backed harnesses continue through [[terminal-io]] unchanged and never open the message endpoints. A
selected headless console performs one full read, then connects from that cursor, so an append between the two
cannot be lost and EventSource reconnect resumes through the standard event id.

Native `user` and `assistant` message content renders in ordered, role-distinct bubbles. Assistant `tool_use`
blocks render as compact summary rows in the same order, naming the tool and the most useful short input rather
than dumping the full event. Lifecycle/system/result envelopes and tool-result payloads remain in the raw data
plane but do not masquerade as chat turns. New rows follow the bottom only while the reader is already there; a
reader inspecting history is never pulled away. Offline headless sessions keep their recorded conversation
visible, with ordinary session commands remaining in the shared toolbar.
