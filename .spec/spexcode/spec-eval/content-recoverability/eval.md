---
scenarios:
  - name: protocol-freeze-and-dry-oracle
    description: >
      Run the content-recoverability runner through its write/check byte-reproduction path, positive and
      negative dry fixtures, aggregate dry oracle, and reconstruction preflight without launching a model.
    expected: >
      The committed census, segmentation, rewrites, taxonomy, rubric, controls, and manifest reproduce byte
      for byte; the positive fixture is admitted, every negative control is rejected, aggregate dry returns
      zero, and preflight records effective module R0 as zero while refusing reconstruction until blinded
      dual labels and the remaining human-authored controls are separately frozen.
    tags: [cli]
    test: spec-eval/bench/reconstruction/recoverability/run.mjs
    code: spec-eval/bench/reconstruction/recoverability/run.mjs
    related:
      - docs/content-recoverability.md
      - spec-eval/bench/reconstruction/recoverability/runs/verification-transcript.txt
---
# protocol-freeze-and-dry-oracle

Measure through the checked-in CLI surface. Capture each command and its return code independently; an
expected nonzero negative-fixture or preflight result is evidence only when the transcript names the gate
that rejected it. No benchmark constructor, judge model, paid run, network call, or R0 may occur.
