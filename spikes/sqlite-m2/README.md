# SQLite M2 engine-detail spike

Disposable, isolated experiment. It is **not** the session protocol implementation and is wired into no
adopter, `sessions.ts`, or `session-core` code. There is no ORM, daemon, outbox, file-observer
correctness path, harness callback, or production integration here.

Its only job is to make every claim in `docs/session-protocol-sqlite-engine.md` executable. Do not treat
its API shape as a production decision; the frozen assets are the schema, the canonical encoding, the
error codes, and the gates.

## Layout

| Path | What it is |
|---|---|
| `engine.mjs` | canonical reference implementation of the frozen contract |
| `drivers/better-sqlite3.mjs` | adapter for the second candidate binding |
| `test/engine.test.mjs` | conformance vectors, single process |
| `test/concurrency.test.mjs` | vectors that need real OS processes |
| `worker.mjs` | one process per invocation, driven by the concurrency vectors |
| `probe-*.mjs` | measurements: driver matrix, DDL behaviour, index plans, thin-CLI cost, cross-build locking |
| `stubs/build.mjs` | generates one deliberately-wrong implementation per frozen decision |
| `stubs/run.mjs` | runs the vectors against each stub and reports which assertions fired |
| `stubs/*.mjs` | **deliberately wrong**, generated, never imported outside the vectors |
| `evidence/` | raw output, kept verbatim |
| `fail-first.log`, `fail-first-note.md` | the original first failure and an honest account of what it proves |

## Running

```sh
node --test test/engine.test.mjs test/concurrency.test.mjs   # 46/46
node stubs/build.mjs && node stubs/run.mjs                   # 7/7 decisions have a counter-example

npm install --no-save better-sqlite3                         # not a dependency; only for these two
M2_DRIVER=better-sqlite3 node --test test/engine.test.mjs     # 40/40, identical vectors
node probe-bs3-semantics.mjs
```

`node:sqlite` is used on Node 24.15.0, whose bundled SQLite is 3.51.3 — the lowest version that carries
the WAL-reset corruption fix the protocol requires. The vectors refuse to run below it, by design.
