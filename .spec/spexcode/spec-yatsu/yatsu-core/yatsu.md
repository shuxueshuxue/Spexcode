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
  - name: sibling-edit-doesnt-stale
    tags: [cli]
    description: >-
      Through the real `spex yatsu scan`: take a node whose yatsu.md holds several scenarios with fresh
      readings, then commit a change to ONE scenario's block (edit it, or add a brand-new sibling
      scenario) in that yatsu.md, leaving every other scenario's block byte-identical. Re-run
      `spex yatsu scan`.
    expected: >-
      Only the scenario whose OWN block moved (or the newly-added one) is flagged `yatsu-drift` on the
      scenario axis; every sibling whose block was untouched stays fresh. The scenario axis is
      per-scenario, not per-file — a sibling's edit never re-stales this reading, so one yatsu.md's
      routine growth no longer generates a wave of false stale scores.
  - name: retract-undoes-a-botched-filing
    tags: [cli]
    description: >-
      Through the real `spex yatsu` CLI in a scratch repo: file a good reading, then a junk one (a
      simulated botched e2e/smoke run), confirm `show` leads with the junk verdict, then run
      `spex yatsu retract <node> --scenario <s> --note <why>`. Re-run `show` and `scan`; retract
      again until nothing is left, and check the loud error on one retract too many plus the
      unknown-flag rejection. Inspect the sidecar file itself.
    expected: >-
      retract appends a retraction event — no sidecar line is ever deleted or rewritten; the junk
      line stays in the file and `show` renders the ⟲ retracted trace beside the readings. The
      effective scoreboard drops the retracted reading everywhere at once: the prior good reading
      is the latest again (scan quiet), and retracting every reading returns the scenario to
      yatsu-missing. A retract with no un-retracted reading left fails loud, as does an unknown
      flag.
---
# yatsu.md — yatsu-core

This node's behaviour is measured through the `spex yatsu` CLI itself (YATU): the AGENT files a reading
with no browser and no executor, `scan` reflects freshness derived live from git, and `clean` prunes the
content-addressed cache. yatsu records the measurement and keeps score; it runs nothing.
