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
      Start a real backend against an isolated governed record and its on-disk rollout. Read the execution REST
      endpoint, subscribe to its SSE, accept a new human input, restart the backend, then append that turn's
      native user boundary and a tool completion to the rollout.
    expected: >-
      The REST and initial SSE frame expose only the rollout's latest commentary working note and its following
      normalized tool rows. The accepted input pushes an empty projection with its new opaque turnId before any
      later transcript event, and the restart reconstructs that same empty fence. Once the matching native
      boundary arrives, only its following rows render; completion pushes a changed revision whose matching row
      becomes done. Previous commentary, tool arguments, and tool output never appear on either public surface.
---

Measure through the running HTTP server, not by importing the parser. The source rollout must contain more
than the desired projection so the reading can prove omission rather than merely seeing a small fixture.
