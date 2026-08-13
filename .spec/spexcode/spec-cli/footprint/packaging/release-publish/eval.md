---
scenarios:
  - name: release-set-is-ordered-and-guarded
    tags: [cli]
    description: >
      Run the release rehearsal against the committed package manifests and exercise the producer's registry
      state checks with an all-absent set and a deliberately partial set.
    expected: >
      The rehearsal emits core, dashboard, eval, forge, CLI, root in order without publishing. A partial
      registry set fails before any publish command. A direct package npm publish is refused with the release
      command that owns the operation.
    test:
      path: scripts/release-publish.test.mjs
      name: release producer keeps one complete ordered package set
---
# release-publish loss

The rehearsal reads the same committed manifests and produces the same package order as the write action. The
partial-registry control is essential because registry writes are not transactional: after one member appears,
the next invocation must stop rather than pretend an incomplete release is recoverable.
