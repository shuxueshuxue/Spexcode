---
scenarios:
  - name: machine-turn-failure-is-one-active-only-cas
    tags: [backend-api, cli]
    code:
      - .spec/spexcode/.plugins/core/session-fail/fail.sh
      - spec-cli/src/sessions.ts#markTurnFailure
    description: >-
      Against real governed session records, invoke the shipped Claude StopFailure machine entry and the
      generic native/headless failure writer in three states: an undeclared active turn, an already-authored
      declaration, and an explicitly stopped record. Read every result through `spex session show --json`.
    expected: >-
      Every signal source converges on one record-locked compare-and-set. The live undeclared active record
      becomes error; the declaration and explicit stop remain byte-for-byte authoritative. Harness differences
      choose only how a native failure becomes a message and completion time, never whether product lifecycle
      semantics overwrite a non-active record.
---
