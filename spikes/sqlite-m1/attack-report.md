# M1 SQLite attack report

Status: spike evidence only. No adopter, `sessions.ts`, or existing `session-core` implementation was changed.
Base: `2572f66c26fc612f93dc36bc586be5b05cc2933e`.

## Fail first

Before `protocol.mjs` existed, `npm test` failed with `ERR_MODULE_NOT_FOUND` for the public `openProtocol` module.
The complete first failure is retained in `fail-first.log`; it was not overwritten by the later passing run.

## Environment and driver

- Driver: Node built-in `node:sqlite`, `DatabaseSync`.
- Node: `v24.15.0` (invoked with `--experimental-sqlite`).
- Database path: an explicit absolute temporary path, for example
  `/tmp/sqlite-m1-attack-QvPzTM/protocol.sqlite`; no cwd/config lookup is used.
- SQLite mode: WAL, `synchronous=FULL`, foreign keys on, configurable `PRAGMA busy_timeout`.

## Attack results

The passing run is captured in `attack-output.json`.

| Vector | Observation |
| --- | --- |
| Two-process enqueue | Two independent workers committed `proc-a` and `proc-b` to one absolute DB. |
| Two-process dequeue race | One worker returned `race-head`; the other returned `null` (`["race-head", null]`). |
| SIGKILL before dequeue commit | A worker changed the head inside an uncommitted transaction, was SIGKILLed, and the message remained pending. |
| SIGKILL after dequeue commit | A worker returned `precommit`, was SIGKILLed after the public call committed, and reopen showed dequeued/no-requeue. This is dequeue at-most-once. |
| WAL/SHM recovery | `journal_mode=wal`; `-wal` and `-shm` were present during the run; reopening and querying after child death succeeded. |
| Busy timeout | A held write transaction plus a 50 ms timeout produced loud `BUSY`, not null/empty state. |
| Lost wake / backend absent | Enqueue while no consumer was present, close, reopen a fresh process, and query found the pending row without a wake hint. |
| Readonly | Read-only open allowed reads; enqueue failed with `READONLY`. |
| Corrupt storage | A damaged SQLite copy failed with `CORRUPT` via `quick_check`; it was not treated as an empty queue. |
| Backup restore | `VACUUM INTO` backup reopened with the message history intact. |
| Retire race | Concurrent enqueue/retire serialized. The captured run had retire first and enqueue returned `RETIRED` (a prior run had enqueue first and retire returned `NON_EMPTY_RETIRE`); no resurrection occurred in either ordering. |
| Migration fixtures | Changed checksum returned `SCHEMA_CHECKSUM`; future schema generation returned `SCHEMA_UNSUPPORTED`. |

The contract tests also cover unknown-session enqueue without address creation, FIFO A/B/null, exact idempotency
replay, changed-byte idempotency conflict, opaque bytes/headers, retained history, retired-address rejection, and
same-database extension mutation plus enqueue rollback.

## Deliberately unfrozen

This spike does not freeze or claim decisions about:

- whether dequeue-at-most-once is the final consumer contract or how a consumer journals downstream handling;
- the exact retire/enqueue race policy beyond SQLite serialization and loud failure;
- the message hash algorithm/canonical encoding (the spike currently uses SHA-256 over an internal encoding);
- message/body/header size limits, quotas, retention, purge, or sequence scope;
- production error class names, migration packaging/checksum ownership, backup policy, or Node driver support matrix;
- notification/wake transport, retry policy, fairness, or starvation under sustained contention.

There is no daemon, outbox, observer-based correctness mechanism, ORM, adapter import, or production integration here.
