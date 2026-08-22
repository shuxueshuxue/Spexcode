# Live session cutover

This is the one-time adaptation path from the legacy JSON session store to the SQLite session application. It is an
operator action, not a normal runtime mode. Schedule a maintenance window and stop every writer before running it.

Create an absolute JSON plan. The old command must be the exact release currently serving the port; the new command
must be the release being installed. `serverPid` must be the actual listener process, not a shell or a supervisor.

```json
{
  "serverPid": 12345,
  "port": 8787,
  "oldCommand": ["/abs/node", "/abs/old/bin/spex.mjs", "serve", "--port", "8787"],
  "newCommand": ["/abs/node", "/abs/new/bin/spex.mjs", "serve", "--port", "8787"],
  "recordsRoot": "/abs/.spexcode/sessions",
  "databasePath": "/abs/.spexcode/sessions.sqlite",
  "backupRoot": "/abs/.spexcode/sessions.sqlite.json-migration-backup",
  "runRoot": "/abs/.spexcode/session-cutover-runs/2026-08-22",
  "cwd": "/abs/new-release",
  "orphanParentPolicy": "fail",
  "timeoutMs": 30000
}
```

Run it with the Node version required by the release:

```sh
/abs/node scripts/session-live-cutover.mjs --plan /abs/cutover.json
```

The runner first proves the old `/health` and `/api/sessions?all=1`, sends `SIGTERM` only to `serverPid`, waits for
that process and port to close, runs the fenced importer, starts `newCommand`, and checks the same two HTTP surfaces
against the new process. Success writes `runRoot/success.json` and leaves the new server running. It never guesses a
process, kills a process tree, or starts a compatibility server.

`orphanParentPolicy` is explicit plan data and defaults to `fail`. Use `tombstone` only after reviewing the migration
inventory: it creates archived application addresses for retired parents and preserves the child-to-parent edges. The
runner does not infer this policy from the source data, because silently choosing it would turn an operator decision
into a hidden data migration.

If migration or the new smoke fails, the runner stops the new process, moves the new database, marker, fence, and
staging files into a timestamped `failed-*` directory below `runRoot`, and starts `oldCommand` again. The source JSON
and migration backup are never deleted. Inspect the emitted rollback result before retrying; a rollback failure is a
manual incident, not a reason to continue serving both formats.

After a successful cutover, the marker makes SQLite authoritative. JSON is not a runtime fallback, and a later run
with the same plan is refused as already migrated.
