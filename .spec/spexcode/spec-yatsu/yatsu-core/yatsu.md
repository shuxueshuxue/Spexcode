---
scenarios:
  - name: scan-eval-clean-loop
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
---
# yatsu.md — yatsu-core

This node's behaviour is measured through the `spex yatsu` CLI itself (YATU): the AGENT files a reading
with no browser and no executor, `scan` reflects freshness derived live from git, and `clean` prunes the
content-addressed cache. yatsu records the measurement and keeps score; it runs nothing.
