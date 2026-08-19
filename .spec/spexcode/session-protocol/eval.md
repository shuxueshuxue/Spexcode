---
scenarios:
  - name: installed-sqlite-package-contract
    tags: [cli]
    description: >
      Pack the protocol and its declared dependencies, install the tarballs in a fresh consumer outside the source
      repository, and use only the public entry with a fresh explicit absolute databasePath. Open the database from
      two processes, initialize one address, enqueue two messages, list, dequeue, read history, and retire it.
    expected: >
      The package resolves without source or TypeScript fallback; both processes observe one SQLite authority;
      initialize, FIFO, stable history, dequeue-at-most-once, empty-queue retirement, and the retained tombstone
      match the M1 contract without a daemon, product config, or harness callback.
    code: packages/session-core/src/index.ts
    related: packages/session-core/package.json
  - name: schema-migration-is-one-portable-authority
    tags: [cli]
    description: >
      Through the installed public open operation, exercise a fresh database, exact migration replay, a fixture with
      one applied migration checksum changed, and a fixture from a future unsupported schema generation.
    expected: >
      Fresh and replayed databases converge on the declared protocol schema. Checksum drift and future schema both
      fail before any protocol read or write; neither is treated as an empty database or silently rewritten.
    code: packages/session-core/src/index.ts
    related: packages/session-core/package.json
  - name: fifo-idempotency-and-retirement
    tags: [cli]
    description: >
      Initialize one address, enqueue A then B, replay A with the same idempotency key and exact bytes, reuse that
      key with one changed byte, attempt retirement while work remains, drain through repeated dequeue, then retire
      and attempt initialize and enqueue again.
    expected: >
      Exact replay returns the original row, changed reuse fails without mutation, pending and dequeue order remain
      A then B, non-empty retirement is atomic failure, and the retired tombstone and full history remain readable
      while resurrection and later enqueue fail.
    code: packages/session-core/src/index.ts
    related: packages/session-core/src/session-protocol.test.ts
  - name: concurrent-dequeue-has-one-commit-winner
    tags: [cli]
    description: >
      Start independent installed-package consumers against one pending message and force their dequeue transactions
      to overlap. Repeat with one process terminated before commit and once immediately after commit.
    expected: >
      Exactly one committed consumer receives the head. A pre-commit rollback leaves it pending; a post-commit exit
      leaves it dequeued and never requeues it. Busy exhaustion is a loud distinct failure, not null or empty state.
    code: packages/session-core/src/index.ts
  - name: same-database-composition-needs-no-outbox
    tags: [cli]
    description: >
      In a fixture-owned extension table within the same database, use the protocol's controlled synchronous
      transaction capability to mutate one extension row and enqueue zero, one, then several notifications. Force
      one transaction to roll back after the extension mutation and before commit.
    expected: >
      Extension state and all protocol messages become visible together or not at all. No outbox, relation-revision
      replay, dispatcher, raw public connection, or partial protocol operation is required or exposed.
    code: packages/session-core/src/index.ts
  - name: explicit-path-opaque-data-and-lost-wake
    tags: [cli]
    description: >
      Run from a process whose cwd, HOME, adopter config, and explicit databasePath are distinct. Enqueue unknown
      message kinds with opaque body bytes and headers while discarding every wake hint, then open a new process at
      the exact databasePath and query pending state.
    expected: >
      Relative paths are refused; no cwd or product config selects storage; bytes and headers round-trip exactly;
      unknown kinds receive no product interpretation; and the new process discovers every pending row solely from
      SQLite state despite all wake hints being lost.
    code: packages/session-core/src/index.ts
---
# session-protocol loss

Measure the contract through a fresh installed package and its public operations. The fixtures are portable protocol
assets: they assert SQLite schema and transaction results, never source layout, a legacy file, or an internal helper.
Until the SQLite implementation exists these scenarios are intentionally missing; old file-protocol readings do not
prove them.
