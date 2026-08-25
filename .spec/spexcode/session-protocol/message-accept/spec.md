---
title: message-accept
status: active
hue: 280
desc: One durable acceptance operation owns record fences, timeline receipt, queue publication, and keyed crash recovery.
related:
  - packages/session-protocol/src/engine.ts
  - packages/session-protocol/src/engine.test.ts
  - packages/session-events/src/schema.ts
  - packages/session-application/src/production.ts
  - spec-cli/src/sessions.ts
---
# message-accept

`acceptMessage` is the complete durable write operation shared by SpexCode CLI and external runtimes. It takes
the target and optional sender record fences in sorted order, runs consumer validation and transport-text
preparation inside that fence, appends the raw conversation event, and publishes the prepared delivery debt.

A keyed retry reads the private receipt before recomposing. The same payload restores an exact missing queue
entry from the frozen delivery bytes, including any producer-owned immutable string attributes; a different payload
under the same key fails loudly. Runtime preflight,
prompt composition, and immediate adapter delivery remain callbacks or later consumer work, never imports.
