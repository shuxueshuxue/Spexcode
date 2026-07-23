---
title: message-stream
hue: 280
desc: The native-event data plane and optional full-process drill-down for adapters that expose a message stream; TimelineChat remains the headless session's main console.
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

`message-stream` owns only the harness-native event data plane and its optional full-process drill-down. A
headless session's main conversation is the shared [[session-timeline]]/`TimelineChat` surface; this node does
not replace it, synthesize terminal state, or import adapter definitions. The adapter advertises the
`messageStream` capability in its data, and both desktop and phone surfaces show the full-process door only
when that capability is true (currently `claude-headless`). The UI consumes the capability, never a harness-id
conditional.

The adapter persists each complete native event as one JSON line in `messages.ndjson`. SpexCode exposes two
reads below `/api/sessions/:id`: `GET /messages` returns every complete event in file order plus the byte cursor
immediately after the last complete line, while `GET /messages/stream` is an SSE append-follow beginning at
`?cursor=` or the reconnecting client's `Last-Event-ID`. Each appended event is one SSE `message` frame whose
id is its next byte cursor. The stream watches file creation and append in the session store, sends a
transport-only heartbeat, and never polls the whole session board. A known session whose adapter has not
created the file yet reads as an empty stream; an unknown session is 404; malformed complete NDJSON fails
loudly instead of disappearing; an unterminated tail stays unread until its newline lands.

The drill-down performs one full read, then follows from that cursor, so an append between the two cannot be
lost and EventSource reconnect resumes through the standard event id. Native `user` and `assistant` content
renders in ordered, role-distinct bubbles; assistant `tool_use` blocks render as compact summary rows. Other
envelopes remain in the raw data plane and do not masquerade as chat turns. New rows follow the bottom only
while the reader is already there; a reader inspecting history is never pulled away. Pane-backed adapters do
not open these endpoints, and offline headless sessions keep the recorded drill-down readable.
