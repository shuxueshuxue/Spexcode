---
scenarios:
  - name: json-migration-one-time-cutover
    tags: [backend-api, cli]
    description: >
      Adapt isolated JSON session and watcher records with the migration command, inspect the backup/marker, and
      repeat the command against the same source.
    expected: >
      The first run imports state, parent/watch topology, and deterministic events; the marker and backup are present;
      the second run reports replayed without changing SQLite, and corrupt or ambiguous input fails before writes.
    test:
      path: packages/session-application/src/migration.test.ts
      name: "JSON migration imports state, parent/watch topology, deterministic event, backup, and marker idempotently"
code: packages/session-application/src/migration.ts
---
# session JSON migration loss

The HTTP cutover matrix also exercises the migration CLI. This package test covers the fail-loud input gate and exact
source digest independently so a broken source cannot be hidden by a backend process.
