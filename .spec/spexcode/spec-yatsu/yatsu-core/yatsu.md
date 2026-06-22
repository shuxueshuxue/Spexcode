---
scenarios:
  - name: scan-eval-clean-loop
    driver: manual
    target: spex yatsu scan | eval | clean
    steps:
      - run `spex yatsu eval .` on this node — a reading lands in yatsu.evals.ndjson with no browser
      - run `spex yatsu scan` — the fresh reading is NOT reported stale
      - touch a governed code file and commit — `spex yatsu scan` now reports the reading stale on the code axis
      - run `spex yatsu clean --all` — the cache empties; records still resolve, blobs render as the miss sentinel
---
# yatsu.md — yatsu-core

This node's behaviour is observed through the `spex yatsu` CLI itself (YATU): the **manual** driver
records a reading without a browser, `scan` reflects freshness derived live from git, and `clean` prunes
the content-addressed cache. The reading this scenario produces is the engine reading its own loss — the
first dogfood of the eval/loss axis.
