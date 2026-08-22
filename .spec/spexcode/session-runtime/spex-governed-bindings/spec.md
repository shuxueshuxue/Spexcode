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
  - .spec/spexcode/session-runtime/spex-governed-bindings-adapter/spec.md
  - .spec/spexcode/session-runtime/spex-governed-bindings-tests/spec.md
  - .spec/spexcode/session-runtime/spex-governed-bindings-yatu/spec.md
---
# Spex governed runtime bindings

The Spex adapter maps an existing governed protocol address to the native harness instance that currently owns it.
The exact identity consists of the harness kind, native harness session id, and a native start token that changes when
the runtime instance changes. The adapter fixes the namespace to `spex-governed` and performs the binding through the
shared protocol transaction seam. It does not create the protocol address or infer any identity field.

The adapter does not own storage placement. Production composition must first resolve one explicit absolute protocol
database path, positively establish local-filesystem locking capability, open that database, initialize the governed
protocol address, and obtain the shared runtime-binding component. Neither `runtimeRoot()`, the legacy session record
directory, nor `session.json` is a protocol database-path authority.

The current governed registration path has a durable `harness_session_id` and Codex generation identity, but it does
not yet receive an explicit protocol database handle or a locality verdict. Non-Codex direct registration also does
not carry a native start token. Until those inputs are added by the owning production composition, this node provides
the exact adapter seam and executable proof only; it does not claim that `bindHarnessSessionIdUnlocked` has cut over.

No optional call, guessed database filename, legacy-JSON fallback, or logical-session-id-as-native-id substitution is
allowed. Missing production inputs remain an explicit cut-in blocker rather than turning the old store into a second
binding authority.
