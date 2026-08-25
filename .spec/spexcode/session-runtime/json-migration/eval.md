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
  - name: json-migration-legacy-residue
    tags: [backend-api, cli]
    description: >
      Run the migration entry point against a store an earlier importer marked without replaying history, whose tree
      still holds legacy envelopes, timeline segments, watcher, pending, and cursor files plus an unclaimed fixture
      directory; then run it again.
    expected: >
      History lands as ignorable migrated events, the missing watch edge and pending debt are absorbed, canonical state
      stays authoritative, the unclaimed directory is reported and retired without a row, every file is backed up first,
      and the second run is a no-op that appends nothing.
    test:
      path: packages/session-application/src/migration.test.ts
      name: "a marked store absorbs legacy residue once: history, watch edges, pending debt, and envelopes are migrated then retired"
  - name: json-migration-residue-reentry-and-cursors
    tags: [backend-api]
    description: >
      Interrupt a residue migration after import but before retire, resume it, and migrate history under a subject that
      a watcher has partially consumed.
    expected: >
      The resumed run appends no duplicate event or queue row and retires the tree; the stored follow cursor moves past
      exactly the history lines that now precede it; a retired envelope with no canonical row is refused.
    test:
      path: packages/session-application/src/migration.test.ts
      name: "residue migration is re-entrant: an interrupted retire resumes without duplicating any event or queue row"
code: packages/session-application/src/migration.ts
---
# session JSON migration loss

The HTTP cutover matrix also exercises the migration CLI. This package test covers the fail-loud input gate and exact
source digest independently so a broken source cannot be hidden by a backend process.
