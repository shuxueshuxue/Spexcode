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
---
# tsx-test-runner loss

The evidence is taken from the packaged binary in a clean consumer, because a source checkout always has the
development compiler available and cannot prove its absence from a release closure.
