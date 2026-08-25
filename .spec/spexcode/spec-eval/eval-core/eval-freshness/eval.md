---
scenarios:
  - name: three-axes-decide-independently
    tags: [cli]
    code: [spec-eval/src/freshness.ts#staleAxes, spec-eval/src/freshness.ts#isStale]
    description: >
      From a fresh reading, exercise each axis alone: commit a change to a governed file; re-wrap the scenario's
      description without changing its words, then change a word; edit only its tags and its `test`; open an
      unresolved remark on the scenario and then resolve it. Read `spex eval lint` after each.
    expected: >
      The code axis stales on the real code commit; the scenario axis is unmoved by a whitespace re-wrap, by a
      sibling scenario's edit, and by tags/test metadata, and moves on the word change; an unresolved remark
      ages the reading and a resolved one keeps it stale until a reading taken after the resolve exists. A
      changed selector never re-stales a stored reading, because `code` is a pointer, not a contract.
  - name: off-history-anchor-falls-back-to-content-then-says-so
    tags: [cli]
    code: [spec-eval/src/freshness.ts#changedSince]
    description: >
      File a reading, then rewrite history so its `codeSha` is orphaned but still present locally; read lint.
      Then prune the anchor object entirely and read again.
    expected: >
      While the anchor object exists, freshness compares content scoped to the reading's governed files:
      byte-identical content reads fresh and a real difference stales exactly the moved axis. Once the object is
      gone the conservative stale is reported as its own ANCHOR axis, so "anchor lost" never reads as "content
      changed", while a hash-bearing reading's scenario axis still testifies.
---
# measuring eval-freshness

Each axis is provoked alone, because the contract is that they decide independently.
