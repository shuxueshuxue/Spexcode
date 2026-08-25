---
scenarios:
  - name: installed-adopter-composition
    tags: [cli]
    description: >
      Pack protocol, topology, and runtime bindings; install them into a repository-external consumer; compose one
      transaction that attaches a parent/child edge, binds an adopter identity, and enqueues a notification; reject
      a stale generation and drain the message exactly once.
    expected: >
      The installed graph contains the three packages and no Spex runtime package; the edge, binding, and exact body
      are observed; stale generation is rejected; the second dequeue is empty; production adopter cut-in remains
      explicitly NOT-MEASURED when no importer or external owner approval is available.
    test: scripts/adopter-integration-yatu.mjs
    code: scripts/adopter-integration-yatu.mjs
    related:
      - .spec/spexcode/session-runtime/runtime-bindings/eval.md
      - .spec/spexcode/session-runtime/zswarm-cutover/zswarm-adopter/eval.md
---
# adopter integration proof

The scenario is measured through the packed installed consumer. It is not a source-only or workspace-resolution test.
