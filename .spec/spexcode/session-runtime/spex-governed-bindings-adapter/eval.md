---
scenarios:
  - name: governed-native-restart-is-generation-fenced
    tags: [backend-api]
    description: The Spex adapter binds a real protocol address, then replaces its native runtime start token through the shared binding component.
    expected: The replacement advances the binding generation, a stale writer is rejected, and detach leaves the protocol address usable.
    code: spec-cli/src/session-runtime-adapter.ts
    related:
      - scripts/spex-governed-bindings-yatu.mjs
---
# Spex governed binding adapter eval

Run `node scripts/spex-governed-bindings-yatu.mjs` after building protocol, runtime, and spec-cli. The executable proof
uses the real protocol database and runtime-binding component. It also prints the separately measured production
composition state; a passing adapter scenario must not be reported as a completed governed product cut-in.
