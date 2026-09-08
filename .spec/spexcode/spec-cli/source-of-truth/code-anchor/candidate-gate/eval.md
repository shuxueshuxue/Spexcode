---
scenarios:
  - name: the-skip-names-unclaimed-source
    tags: [cli]
    code: spec-cli/templates/hooks/reference-transaction
    related: [spec-cli/src/lint.ts]
    test:
      path: spec-cli/src/commit-gate.test.ts
      name: a candidate that only adds unclaimed source is allowed, but the skip names the file
    description: >-
      In a repository with the hooks installed and `governedRoots: ["src"]`, commit a new source file that no
      spec claims — the shape that touches nothing governed and therefore takes the gate's skip path. Then
      commit a non-source path, a test-glob path, a source path outside `governedRoots`, and an edit to a
      governed file.
    expected: >-
      The unclaimed-source commit LANDS (coverage is a warning, not a gate) and the gate names the file on
      stderr, so a skipped candidate is no longer indistinguishable from a checked one. The other four commits
      draw no such notice: the non-source, test-glob, and outside-roots paths stay silent, and the governed
      edit goes down the full lint path where coverage already speaks. Full `spex spec lint` reports the same
      gap the gate named.
---
# eval.md — candidate-gate

The loss is a coverage gap created by exactly the commit shape that the gate skips: afterwards there is no way
to tell a candidate that was checked and passed from one that was never checked at all.
