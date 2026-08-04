---
scenarios:
  - name: foreground-eval-does-not-wait-for-background-ledger-writer
    tags: [backend-api]
    test: spec-eval/src/sessioneval-ledger-demand.api.test.ts
    code:
      - spec-cli/src/git.ts#withEventCacheLock
      - spec-cli/src/git.ts#withEventLedgerDemand
      - spec-eval/src/sessioneval.ts#buildSessionEvals
    description: >-
      Start an isolated real backend over a linked-worktree session, then let an independent live process acquire
      that repository's source-of-truth event-ledger write transaction and hold it open. While the writer remains
      alive and still owns the lock, request the selected session through the public
      `/api/evals?q=is:eval scope:<id>` surface. Capture the HTTP status, response shape, writer identity state,
      export and summary projections, replay behavior, stale-generation recovery, and the lock/snapshot failure
      boundaries.
    expected: >-
      The selected eval request returns one coherent HTTP 200 projection while the unrelated writer still owns
      the ledger transaction. It consumes the ledger's atomic integrity-checked snapshot and derives any missing
      immutable facts through the same Git adapters; it never waits for the writer's complete build, returns a
      lock-timeout error, substitutes an empty impact, or opens a second cache. If no writer is present, the same
      demand path retains the ordinary locked transaction and persists newly derived facts. A corrupt snapshot is
      rebuilt from Git without replacing a live writer's bytes; Git failure, unknown lock identity, or repeated
      interpretation-identity movement remains loud. A content-revision replay does not enter the lock, a reused PID
      cannot retain it, and a normal release between losing create and owner observation retries acquisition.
---
Foreground demand retains the durable ledger's meaning without inheriting an unrelated writer's wall time.
