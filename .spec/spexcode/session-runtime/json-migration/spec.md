---
title: session JSON migration
status: active
hue: 280
desc: One-time deterministic adaptation of JSON session records into the authoritative SQLite application store.
code:
  - packages/session-application/src/migration.ts
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
  - .spec/spexcode/session-runtime/production-cutin/spec.md
  - scripts/migrate-session-json.mjs
---
# session JSON migration

`migrateJsonSessionRecords` is the only adaptation path from the retired JSON application records. It scans records
and watcher files in stable lexical order, validates ids, statuses, parent references, watcher sources, duplicates, and
cycles before opening SQLite, and fails loudly on corrupt or ambiguous input. The source bytes receive a SHA-256
content digest, are copied to an auditable backup, and are fenced by a marker containing the digest and import counts.

Import creates protocol addresses, application state, parent/watch topology edges, and one deterministic state event per
record. Re-running the exact source is a no-op after marker verification; a changed source or a missing marked database
is an error. After the marker is written, JSON remains only operational worktree metadata and is never a runtime source
for state, events, topology, or watchers.
