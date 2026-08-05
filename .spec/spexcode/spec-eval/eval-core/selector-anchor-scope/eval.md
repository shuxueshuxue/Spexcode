---
scenarios:
  - name: rebuild-at-one-revision-pays-selector-anchors-once
    tags: [backend-api]
    code: [spec-eval/src/freshness.ts]
    description: >-
      In a fresh process with no server and no HTTP, drive the real `graphCache` full producer against a
      corpus whose eval readings carry anchored `code:` entries (this repo governs itself: on the order of a
      thousand distinct selector queries). Build the board, then force repeated FULL rebuilds
      by moving one issue file — so the drift-index tip, every governed source file, and every reading stay
      byte-identical between rebuilds. Read the build time the product itself reports against its own
      `SPEXCODE_BOARD_BUDGET_MS` budget once the durable caches have warmed and the board has converged.
    expected: >-
      A rebuild whose revision and sources did not move re-derives no selector-anchor verdict and issues no
      hit-engine query, so the steady-state full build lands inside the 1500 ms budget and `/api/graph build
      took …ms (budget 1500ms) — full path is slow` stops firing. Before the scope existed the same
      steady-state rebuild sat at ~1980 ms and warned on every single one.
  - name: retained-verdicts-are-byte-equal-to-the-full-recompute
    tags: [backend-api]
    code: [spec-eval/src/freshness.ts]
    description: >-
      On one corpus state, build the board twice from the same inputs — once on the implementation that
      retains no verdict (the full recompute) and once on the scoped implementation serving every verdict
      from its current-revision scope — and compare the two boards byte for byte. Read the answer's own
      top-level key set first (`identity`, `issuesStamp`, `nodes`, `sessions`; overlays live inside
      `nodes[].overlays`) and assert the comparison is non-vacuous before diffing the body.
    expected: >-
      Identical bytes, judged against a control of two BYTE-IDENTICAL copies of the code compared the same
      way — the scoped board must match the recompute exactly as closely as identical code matches itself,
      so any harness residue is visible instead of being argued away. Same top-level keys, equal per-key
      digests, equal serialized length, and a comparison proven non-vacuous (the whole node set present,
      a substantial subset carrying eval summaries and overlays, verdicts actually resident). A key the
      board does not carry must not be able to report "identical" by comparing nothing on both sides.
---

# selector-anchor-scope — evals

The budget the first scenario reads is the product's own (`graphCache`'s `BUDGET_MS`), not one invented for
the measurement. The second scenario is the correctness half and outranks it: a faster board that is not the
same board is a regression, so the recompute stays in the tree as the answer's definition.
