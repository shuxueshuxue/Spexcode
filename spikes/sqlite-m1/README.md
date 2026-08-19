# SQLite M1 executable spike

This is a disposable, isolated experiment. It is not the session protocol implementation and is not wired into
any adopter, `sessions.ts`, or `session-core` public code. It intentionally has no ORM, daemon, outbox, file
observer correctness path, or harness callback.

Run the vectors with Node's experimental built-in SQLite driver:

```sh
npm test
node --experimental-sqlite attack.mjs
```

The spike uses `node:sqlite` `DatabaseSync` on Node `24.15.0`. The database path is supplied by the caller and must
be absolute. The implementation is deliberately small and disposable; do not treat its schema, API, hashes, or
limits as a production decision.
