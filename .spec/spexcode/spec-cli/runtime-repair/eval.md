---
scenarios:
  - name: rotate-unhealthy-codex-root
    tags: [cli, backend-api]
    description: >
      With a live current Codex generation, run the shipped `spex runtime rotate codex`, then create a
      real parentless Codex session and let it declare asking. Inspect the generation ledger before
      closing only that verification session.
    expected: >
      Rotation proves a fresh current endpoint and marks the previous endpoint draining without signalling
      it. The verification session becomes online, has a native thread binding on the new generation, and
      can declare asking; its exact close succeeds. Existing old-generation bindings remain unchanged.
    code: spec-cli/src/runtime-rotate.ts
    related: spec-cli/src/codex-runtime-generations.ts
---

# runtime-repair loss

The product proof uses the shipped CLI and a real Codex app-server thread/start, not a ledger-only helper.
