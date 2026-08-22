---
title: runtime bindings errors
status: active
hue: 280
desc: Stable error codes for invalid runtime binding ownership and generation operations.
code:
  - packages/session-runtime/src/errors.ts
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# runtime bindings errors

Binding failures are typed and fail loudly: invalid identity input, unknown or retired protocol address, missing or
stale generation, and storage failure are distinct conditions. The error type does not expose or normalize native
process errors; adopters decide how to surface those after the binding contract has failed.
