---
scenarios:
  - name: off-history-content-probes-batch-across-anchors
    tags: [backend-api]
    code:
      - spec-eval/src/freshness.ts#contentBatchArgs
      - spec-eval/src/freshness.ts#argvBytes
      - spec-eval/src/freshness.ts#contentBatchChunks
      - spec-eval/src/freshness.ts#parseContentBatch
      - spec-eval/src/freshness.ts#resolvedContentImages
      - spec-eval/src/freshness.ts#runContentBatch
      - spec-eval/src/freshness.ts#startPluralContentBatch
      - spec-eval/src/freshness.ts#contentProbeFor
      - spec-cli/src/git.ts#batchRevisionOids
      - spec-cli/src/git.ts#gitObjectInterpretation
      - spec-eval/src/evaltab.ts#evalTimelines
    test:
      path: spec-eval/src/freshness-content-batch.api.test.ts
      name: cold public eval populations batch off-history content probes across anchors
    description: >-
      In an isolated real Git project, create forty readable measurement commits on a side branch, keep all
      forty codeSha values off the current main/session history while their governed file and scenario
      contracts stay byte-identical, and file one current reading per scenario. Start a fresh real backend
      for an unscoped Evals list and another fresh backend for the same session-scoped list, counting Git
      content transports through a PATH shim; then repeat each unchanged request.
    expected: >-
      Both cold public reads return the same forty fresh pass rows, full-set counts, and 25-row first page.
      One object batch plus bounded pair-diff chunks answer the complete off-history anchor set; content
      child count follows the chunk bound, never the forty anchors, and the unchanged repeat starts none.
      Anchor/current replacements and grafts rotate the resolved image identity; a missing anchor becomes
      available after its object is fetched; SHA-256 object ids remain native. One anchor with more than 8192
      long requested paths splits under both record and argv-byte limits, and failure after an earlier slice
      publishes no partial verdict. Batching also preserves mode-change, deletion, literal glob/space path,
      abort/no-poison, and exact per-path verdict semantics.
---
# eval.md — off-history-content-probe

The backend/API surface and the core freshness controls measure the same planner: public rows and counts must
stay byte-equivalent while process count stops scaling with the off-history anchor set.
