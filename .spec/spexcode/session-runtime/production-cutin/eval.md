---
scenarios:
  - name: configured-backend-composition
    tags: [backend-api]
    description: >
      Start a Spex backend with only SPEXCODE_HOME and exercise the canonical runtime HTTP API plus the one-time
      migration CLI against isolated records.
    expected: >
      Ten distinct stories pass individually: parent/child, multiple watchers, reparent, state replay, restart,
      generation fencing, ordered delivery, publish ordering, independent pairs, and migration marker idempotence.
    test:
      path: spec-cli/src/session-production-cutover.yatu.test.ts
      name: "YATU cutover matrix: ten distinct stories through the backend HTTP and migration CLI surfaces"
    code: spec-cli/src/session-application.ts
---
# session runtime production cut-in loss

Measure this through the real HTTP backend. The package-level composition test is supporting evidence; the YATU is the
authoritative product reading for the configured Spex hook.
