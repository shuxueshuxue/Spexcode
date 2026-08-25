---
title: session events errors
status: active
hue: 280
desc: Stable event-store failure identities above SQLite and protocol internals.
code:
  - packages/session-events/src/errors.ts
related:
  - .spec/spexcode/session-runtime/session-events/spec.md
---
# session events errors

Invalid envelopes, missing subjects, duplicate ids, corrupt sequences, unknown required event types, invalid
transactions, and component storage failures surface as `SessionEventError` with a stable `EVENT_*` code.
