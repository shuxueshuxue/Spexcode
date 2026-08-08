---
scenarios:
  - name: latest-working-note-slice
    tags: [backend-api]
    test: spec-cli/src/execution-trace.test.ts
    code: spec-cli/src/execution-trace.ts
    related:
      - spec-cli/src/session-execution.api.test.ts
    description: >-
      Feed each base adapter reader an older native turn, the selected current-turn boundary, private reasoning,
      ordinary assistant working prose, structured tool input, and a matching completion.
    expected: >-
      Before the first durable human send, each reader exposes the latest native launch slice with a null turn
      id. After a selector exists, each reader accepts only its selected current turn, takes the last displayable
      assistant prose, and keeps only later typed tool rows. A matching completion updates its row; safe
      structured input becomes a short detail while sensitive arguments, output, private reasoning, and earlier
      turns are absent from the normalized object. The four headless rows inherit their base readers.
---

The HTTP scenario under [[session-execution]] is the product-level proof. This narrow parser scenario guards the
adapter's private boundary so a native rollout schema shift fails before it can leak a raw field onto that route.
