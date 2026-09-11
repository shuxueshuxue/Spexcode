---
title: Spex governed runtime bindings
status: active
hue: 280
desc: The exact Spex-owned seam between a governed session record and the shared runtime binding component.
code:
  - docs/session-spex-governed-bindings-plan.md
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-runtime/spex-governed-bindings/spex-governed-bindings-adapter/spec.md
  - .spec/spexcode/session-runtime/spex-governed-bindings/spex-governed-bindings-tests/spec.md
  - .spec/spexcode/session-runtime/spex-governed-bindings/spex-governed-bindings-yatu/spec.md
---
# Spex governed runtime bindings

The Spex adapter maps an existing governed protocol address to the native harness instance that currently owns it.
The exact identity consists of the harness kind, native harness session id, and a native start token that changes when
the runtime instance changes. The adapter fixes the namespace to `spex-governed` and performs the binding through the
shared protocol transaction seam. It does not create the protocol address or infer any identity field.

The adapter does not own storage placement. Production composition must first resolve one explicit absolute protocol
database path, positively establish local-filesystem locking capability, open that database, initialize the governed
protocol address, and obtain the shared runtime-binding component. Neither `runtimeRoot()`, the legacy session record
directory, nor the runtime envelope `runtime.json`, is a protocol database-path authority.

Production binds through the backend's application composition, which resolves the explicit database path and its
locality verdict for every canonical write, and every governed record carries its native start token. `sessions.ts`
has one binding writer for every adapter: it binds the adapter's exact native target identity ([[harness-adapter]])
with the record's start token. That writer is what production calls to bind, and the teardown that stops or closes a
session releases the binding through this node's leaf seam (`unbindSpexGovernedRuntime`), so a binding means an
attached runtime.

No optional call, guessed database filename, or legacy-JSON fallback is allowed, and a logical session id never
substitutes for a native id. A caller-pinned adapter is not such a substitution: its launch passed the governed id to
the harness as the native id, which is exactly what its exact native target identity reports. A native-assigned
adapter is bound only with the id captured from it.
