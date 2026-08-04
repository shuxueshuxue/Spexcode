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
      and the backend's bounded lock failure if the request queues.
    expected: >-
      The selected eval request returns one coherent HTTP 200 projection while the unrelated writer still owns
      the ledger transaction. It consumes the ledger's atomic integrity-checked snapshot and derives any missing
      immutable facts through the same Git adapters; it never waits for the writer's complete build, returns a
      lock-timeout error, substitutes an empty impact, or opens a second cache. If no writer is present, the same
      demand path retains the ordinary locked transaction and persists newly derived facts. A corrupt snapshot,
      Git failure, or repeated interpretation-identity movement remains loud rather than becoming availability.
---
Foreground demand retains the durable ledger's meaning without inheriting an unrelated writer's wall time.
