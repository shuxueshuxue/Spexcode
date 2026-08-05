---
concern: upload resume answers with an offset 2.5x the committed bytes on a real backend
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
created: 2026-08-05T17:51:41.729Z
---

Measured on trunk 8966f1085, spec-cli suite, Node 22, box at load ~11:

    not ok 615 - real backend resumes a configured large attachment and promotes only the complete bytes
    spec-cli/src/uploads.api.test.ts
    error: Expected values to be strictly deep-equal
      { error: 'upload offset does not match the committed bytes',
    +   offset: 327475      (actual)
    -   offset: 130867      (expected) }

Not a timeout — a value mismatch, failureType `testCodeFailure`. The error string is the
right one; the number attached to it is wrong, and wrong in the direction of MORE bytes
already committed than the test staged (2.5x).

Pre-existing, not introduced by tonight's merges: the test exists unchanged at 8966f1085^1
and the branch merged there (node/b7b3) added only two passing tests. I did not diagnose it
and am deliberately not guessing — recording the reading so it is not lost.

The shape worth checking first, because it would explain "more committed than staged":
leftover state from an earlier run being read as this run's progress. That is the same family
as the temp-store leak being fixed under session 3f72d2a2, so whoever picks this up should
check for cross-run residue before suspecting the resume arithmetic.
