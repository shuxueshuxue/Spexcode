---
scenarios:
  - name: release-launcher-needs-no-typescript-loader
    tags: [cli]
    description: >
      Install the root tarball into a clean production consumer, where neither tsx nor TypeScript is present.
      Invoke the shipped `spex` binary and inspect the resulting child command while running `--help` and an L0
      command.
    expected: >
      The launcher starts `@spexcode/spec-cli/dist/cli.js` with Node, both commands work, and the consumer
      dependency tree contains neither tsx nor esbuild. Repository source tests may still use their dev-only
      loader for source fixtures.
  - name: source-session-materialize-keeps-node-loader
    tags: [backend-api]
    description: >
      Run the session-create transaction API test in the source checkout, including its injected backend-death
      materialize path.
    expected: >
      Source-internal child processes use Node's tsx loader directly, so the injected materialize child is
      identifiable as `cli.ts materialize` and the request rolls back cleanly when that process dies.
    test:
      path: spec-cli/src/session-create-transaction.test.ts
      name: public session create is bounded, rollback-clean, idempotent, and publishes exact Git state
    code: spec-cli/src/session-create-transaction.test.ts
---
# tsx-test-runner loss

The evidence is taken from the packaged binary in a clean consumer, because a source checkout always has the
development compiler available and cannot prove its absence from a release closure.

The transaction scenario complements that release proof. It runs through the source backend's public session
creation API, whose test fixture kills the materialize process after its durable record is written. Its output
proves that the development-only loader still preserves that process contract while release launchers stay on dist.
