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
  - name: residue-settles-on-first-canonical-access
    tags: [backend-api]
    description: >
      Point the backend composition at a marked store whose legacy tree still holds a session envelope and timeline,
      inspect the cutover state, take one canonical access, and inspect again.
    expected: >
      The state reads residue, the first access migrates the history into the owned store and retires the tree, the
      state then reads ready from memory, and a later access returns the same composition without re-running.
    test:
      path: spec-cli/src/session-application.test.ts
      name: "a marked store with legacy residue settles on its first canonical access, then reads as ready"
---
# session runtime production cut-in loss

Measure this through the real HTTP backend. The package-level composition test is supporting evidence; the YATU is the
authoritative product reading for the configured Spex hook.
