---
scenarios:
  - name: latest-working-note-slice
    tags: [backend-api]
    test: spec-cli/src/execution-trace.test.ts
    code: spec-cli/src/execution-trace.ts
    related:
      - spec-cli/src/session-execution.api.test.ts
    description: >-
      Feed a Codex rollout containing an earlier commentary note, a later working note, tool arguments, tool
      output, and a final incremental completion through the adapter parser.
    expected: >-
      Only the last working note and its following typed steps survive. A completion updates its matching row
      incrementally; older notes, arguments, and output are absent from the normalized object.
---

The HTTP scenario under [[session-execution]] is the product-level proof. This narrow parser scenario guards the
adapter's private boundary so a native rollout schema shift fails before it can leak a raw field onto that route.
