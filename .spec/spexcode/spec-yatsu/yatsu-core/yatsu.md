---
scenarios:
  - name: scan-eval-clean-loop
    tags: [cli]
    description: >-
      Drive the whole loop through the real `spex yatsu` CLI on this node: file a reading with
      `spex yatsu eval yatsu-core --pass`, confirm `spex yatsu scan` does not flag it, move a
      governed code file and commit, confirm `spex yatsu scan` now reports it stale on the code
      axis, then run `spex yatsu clean --all`.
    expected: >-
      A reading lands in yatsu.evals.ndjson with no browser and no test run; scan is quiet while
      the reading is fresh and flags it stale only after the governed file moves; clean empties
      the cache while the records still resolve (their blobs render as the miss-original-file
      sentinel).
  - name: schema-gate-rejects-malformed
    tags: [cli]
    description: >-
      Through the real `spex` surface, write a yatsu.md with a typo'd field key and a missing
      `expected` into a node dir, then (a) run `spex yatsu scan` and (b) stage it and run
      `spex yatsu check-staged`. File the transcript with
      `spex yatsu eval yatsu-core --scenario schema-gate-rejects-malformed --result <txt> --pass`.
    expected: >-
      scan reports a `yatsu-schema` finding naming each violation (unknown key, missing required
      field) and counts it under "N malformed"; check-staged prints the same violations and exits
      non-zero (blocking the commit), while a well-formed staged yatsu.md exits zero.
---
# yatsu.md — yatsu-core

This node's behaviour is measured through the `spex yatsu` CLI itself (YATU): the AGENT files a reading
with no browser and no executor, `scan` reflects freshness derived live from git, and `clean` prunes the
content-addressed cache. yatsu records the measurement and keeps score; it runs nothing.
