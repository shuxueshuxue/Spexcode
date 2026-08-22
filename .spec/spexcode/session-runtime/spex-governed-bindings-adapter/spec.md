---
title: Spex governed binding adapter
status: active
hue: 280
desc: Structural adapter from Spex-owned native identity to the shared runtime binding transaction.
code:
  - spec-cli/src/session-runtime-adapter.ts
related:
  - .spec/spexcode/session-runtime/spex-governed-bindings/spec.md
---
# Spex governed binding adapter

The adapter fixes the `spex-governed` namespace and maps the exact governed protocol id, harness kind, native harness
session id, and native start token into the shared binding store. Bind and unbind use the protocol transaction host
supplied by composition. Resolve uses the same fixed namespace. Missing identity fields fail before a transaction is
entered; the adapter never derives a storage path or native identity.
