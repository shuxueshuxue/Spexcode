---
scenarios:
  - name: configured-backend-composition
    tags: [backend-api]
    description: >
      Start a Spex backend with SPEXCODE_SESSION_DATABASE_PATH set to an absolute local path and exercise the
      runtime API against the newly created parent/child records.
    expected: >
      The configured composition opens once, leaves legacy records untouched when disabled, and exposes explicit
      state/event/replay, binding, publish, and dequeue boundaries without inferring a native identity.
    test:
      path: spec-cli/src/session-runtime-production.yatu.test.ts
      name: "YATU: CLI-created parent/child state survives backend restart and delivers a fenced watcher notification"
    code: spec-cli/src/session-application.ts
---
# session runtime production cut-in loss

Measure this through the real HTTP backend. The package-level composition test is supporting evidence; the YATU is the
authoritative product reading for the configured Spex hook.
