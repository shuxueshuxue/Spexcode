---
title: session events schema
status: active
hue: 280
desc: The strict append-only component table and per-subject sequence indexes.
code:
  - packages/session-events/src/schema.ts
related:
  - .spec/spexcode/session-runtime/session-events/spec.md
---
# session events schema

The first component migration creates one strict `session_events` table. Its composite primary key is
`(subject_session_id, event_seq)`, `event_id` is globally unique, and update/delete triggers make prior facts
append-only. The table references `protocol_sessions` but does not change that table.
