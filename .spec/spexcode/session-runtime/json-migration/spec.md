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
  - scripts/session-live-cutover.mjs
  - scripts/session-live-cutover.test.mjs
  - docs/session-live-cutover.md
---
# session JSON migration

`migrateJsonSessionRecords` is the only adaptation path from the retired JSON application records. It scans records
and watcher files in stable lexical order, validates ids, statuses, parent references, watcher sources, duplicates, and
cycles before opening SQLite, and fails loudly on corrupt or ambiguous input. The source bytes receive a SHA-256
content digest, are copied to an auditable backup, and are fenced by a marker containing the digest and import counts.
The importer never writes a partially populated target: it builds a sibling staging SQLite file, closes it, and atomically
renames it into the requested database path only after every record, edge, event, and tombstone succeeds. An existing
database without a matching migration marker is ambiguous and is refused rather than appended to.

Legacy `parent: ""` is the historical spelling of a root and is normalized to `null` before validation. A child may
also point at a parent whose record was already retired from the JSON root. The default remains fail-closed for that
orphan relation. The one-time importer may be explicitly run with `orphanParentPolicy: "tombstone"` (the CLI spelling
is `--orphan-parent tombstone`); it creates a deterministic `archived` application address for each such parent and
keeps the child-to-parent topology edge. The report and migration marker list those tombstones, so the data loss is
visible and repeatable rather than silently detaching the child. This policy is migration-only; normal runtime never
reads the JSON root or fabricates missing application state.

Import creates protocol addresses, application state, parent/watch topology edges, and one deterministic state event per
record (plus one deterministic archived event per explicit tombstone). Re-running the exact source is a no-op after
marker verification; a changed source or a missing marked database is an error. After the marker is written, JSON
remains only operational worktree metadata and is never a runtime source for state, events, topology, or watchers.

The importer owns a durable `.json-migration.lock` fence in the legacy sessions root. Legacy writers reject a fenced
store before touching `session.json` or `watchers.json`; after the SQLite marker is published, canonical application
state is authoritative and any remaining JSON writes are only the existing operational projection. The importer takes
the fence before its source snapshot, re-reads the complete file set and digest immediately before installing SQLite,
and aborts without publishing the database when the source changed during the window. A successful cutover therefore
requires a quiet writer set, and a live process that does not honor the fence is a cutover failure, not a reason to
accept drift. A fresh project with no legacy session directories initializes an empty canonical store through the same
marker path; it does not enter a JSON compatibility mode.

Production replacement is a one-time, operator-driven cutover, not a runtime fallback. The supplied cutover plan
names the exact old server pid, old and new argv, port, records root, database path, and a private run directory. The
runner refuses a missing or unhealthy old server, stops only that pid, runs the importer, starts the new argv, and
proves `/health` plus `/api/sessions?all=1` against the new process before reporting success. A failed migration or
smoke check never deletes the source or target: it quarantines target/marker artifacts under the run directory and
restarts the named old argv, then reports the rollback result. It must not guess a process, kill a process tree, or
start a compatibility server. The old and new commands are explicit plan data; normal runtime has no knowledge of
this operation.
