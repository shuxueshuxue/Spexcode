---
title: runtime bindings schema
status: active
hue: 280
desc: The strict adopter-owned schema and component migration for runtime identity bindings.
code:
  - packages/session-runtime/src/schema.ts
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# runtime bindings schema

The component migration creates the strict `session_runtime_bindings` table in the adopter's protocol database. The
primary key is `(namespace, protocol_session_id)` and the native identity, generation, status, timestamps, and
bounded JSON metadata are explicit columns. The schema references protocol addresses but does not add columns to
`protocol_sessions` or create a second protocol commit authority.
