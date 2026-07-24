---
title: message-stream
hue: 280
desc: Retired native-event drill-down — a terminal-free console is the TimelineChat conversation itself, with no second full-process view.
related:
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---

# message-stream

This feature is retired. A headless session's console is exactly the shared
[[session-timeline]]/`TimelineChat` conversation on desktop and phone. The conversation is already the durable
record a reader needs, so it exposes no full-process door, alternate native-event view, adapter capability,
native-message REST/SSE routes, or second session-store transcript.

Harness-native stream output remains an adapter transport detail where a headless runtime needs it; SpexCode
does not project those envelopes into a second user-facing record. Pane-backed adapters continue to render
their live terminal. This node remains in the tree to make that retired boundary explicit rather than leaving
old links or deleted-file anchors behind.
