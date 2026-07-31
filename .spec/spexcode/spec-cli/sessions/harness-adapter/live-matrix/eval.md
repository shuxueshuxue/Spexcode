---
scenarios:
  - name: matrix-run
    tags: [backend-api]
    test: { path: spec-cli/scenarios/harness-live-matrix.ts, name: "one run per registered launcher" }
    description: >-
      Run `npx tsx spec-cli/scenarios/harness-live-matrix.ts <launcher>` end to end once per two DIFFERENT
      real harness launchers (e.g. pi and opencode) from a committed HEAD: the same test file, only the
      launcher argument varying.
    expected: >-
      Each run drives one real dispatched worker through all eight declared scenarios, files a per-scenario
      reading with its evidence transcript, and prints an honest summary (skip = unprovoked, never a
      fabricated verdict). The same test file covers the second harness; adding a harness requires its
      launcher and scenario declarations, not a new CLI route.
---
