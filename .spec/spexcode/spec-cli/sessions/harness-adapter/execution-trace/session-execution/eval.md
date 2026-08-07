---
scenarios:
  - name: codex-execution-trace-projection
    tags: [backend-api]
    test: spec-cli/src/session-execution.api.test.ts
    code: spec-cli/src/session-execution.ts
    related:
      - spec-cli/src/harness.ts
      - spec-cli/src/execution-trace.ts
      - spec-cli/src/index.ts
      - spec-cli/src/execution-trace.test.ts
    description: >-
      Start a real SpexCode backend against an isolated governed Codex record and its on-disk rollout. Read
      the execution REST endpoint, subscribe to its SSE, then append a native tool completion to the rollout.
    expected: >-
      The REST and initial SSE frame expose only the rollout's latest commentary working note and its following
      normalized tool rows. Appending the completion pushes a changed revision whose matching row becomes done;
      previous commentary, tool arguments, and tool output never appear on either public surface.
---

Measure through the running HTTP server, not by importing the parser. The source rollout must contain more
than the desired projection so the reading can prove omission rather than merely seeing a small fixture.
