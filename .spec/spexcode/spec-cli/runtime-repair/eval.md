---
scenarios:
  - name: switch-app-server-without-disrupting-existing-session
    tags: [cli, backend-api]
    description: >
      In an isolated Git project, create one real Codex session to establish a current app-server, then run
      the shipped `spex doctor repair app-server`. Capture its receipt, then stop and close that same
      verification session.
    expected: >
      The switch proves a fresh current endpoint and marks the previous endpoint draining without signalling
      it. The existing verification session remains controllable and its exact close succeeds. The repair
      itself neither creates nor moves a session.
    code: spec-cli/src/runtime-rotate.ts
    related: spec-cli/src/codex-runtime-generations.ts
---

# runtime-repair loss

The product proof uses the shipped CLI and a real Codex app-server thread/start, not a ledger-only helper.
