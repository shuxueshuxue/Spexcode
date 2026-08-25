---
scenarios:
  - name: each-axis-moves-alone
    tags: [cli]
    code: [spec-eval/src/freshness.ts#staleAxes, spec-eval/src/freshness.ts#isStale]
    description: >
      From a fresh reading in an adopted project, provoke each axis by itself and read `spex eval lint` after
      each: commit a change to the governed file; re-wrap the scenario's description without changing its words,
      then change one word; edit only its tags and add a `test`; narrow its `code` to a `path#symbol` selector;
      add a sibling scenario; open an unresolved remark on the scenario.
    expected: >
      Only the matching axis moves, and each names itself — `code changed`, `scenario changed`, `remark changed`.
      A whitespace re-wrap, a tags/test edit, a selector change, and a sibling scenario's arrival all leave the
      stored reading fresh, because `code` is a pointer and metadata is not a measurement contract; the word
      change and the governed-code commit each stale it; an unresolved remark ages it like a drift event.
  - name: a-remark-clears-only-after-a-second-party-resolve
    tags: [cli]
    code: [spec-eval/src/freshness.ts#staleAxes]
    description: >
      With an unresolved remark aging a scenario, file a fresh reading; then have a SECOND party resolve the
      remark (self-resolve is refused by [[remark-substrate]], so one hand cannot drive this alone); then file a
      reading after the resolve.
    expected: >
      Re-running before the resolve does not clear it, the resolve alone unlocks rather than clears, and only a
      reading whose timestamp post-dates the resolve reads fresh.
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
