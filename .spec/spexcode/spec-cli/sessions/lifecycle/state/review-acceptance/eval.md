---
scenarios:
  - name: historical-candidate-is-judged-against-repeated-main
    tags: [cli]
    test:
      path: spec-cli/src/review-acceptance.test.ts
      name: review acceptance compares repeated unions, signs cached provenance, and expires evidenced flaky exemptions
    description: >-
      From a committed worktree, invoke the real `spex internal review-gate` surface with the lane's step-3
      commit as candidate and its contemporary main commit as base. Preserve the complete terminal result and
      inspect the candidate and main run counts, exact SHAs, fresh-or-cached baseline provenance, candidate-only
      failures, named flaky decisions, and final exit status.
    expected: >-
      Candidate and main each run at least twice and comparison uses each side's union. The result names both
      exact SHAs and run counts; a cache hit additionally names its collection time and cannot hide low
      confidence. Every registered flaky entry remains printed as applied, not needed, or not applied with its
      evidence or expiry reason. The
      historical step-3 candidate reports its three session regressions as candidate-only and exits non-zero.
      Typecheck runs as a member of the same configured suite.
---

# review acceptance - eval

Measure through the public declaration or the CLI's exact-commit diagnostic surface. The historical replay is
the non-vacuous regression population: report all candidate-only failures, not merely that the command failed.
Raw transcripts and run logs live in a persistent directory outside the product repository and are published
only after their paths are rechecked.
