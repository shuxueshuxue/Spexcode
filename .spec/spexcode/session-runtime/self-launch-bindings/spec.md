---
title: self-launch runtime bindings
status: active
hue: 280
desc: The explicit self-launch adapter seam for attaching a caller-owned native harness identity to a protocol address.
code:
  - packages/session-selflaunch/src/index.ts
  - packages/session-selflaunch/src/index.test.ts
  - docs/session-selflaunch-bindings-plan.md
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
  - .spec/spexcode/session-runtime/self-launch-entry/spec.md
  - .spec/spexcode/session-protocol/spec.md
---
# self-launch runtime bindings

Self-launch does not infer a native harness identity from the protocol session id, process id, database path, or
environment. A caller that actually owns a native harness may explicitly call `bindSelfLaunchRuntime` with its native
session id and start token. The package fixes its adopter namespace to `self-launch`, delegates generation fencing and
transactionality to `@spexcode/session-runtime`, and exposes resolve/unbind for the same address.

The binding API does not launch, stop, probe, or claim liveness for a harness. It does not change the one-shot CLI's
dequeue boundary. A self-launch path without a real native identity remains unbound; it is not a failed attempt to
manufacture identity from a logical session id.

## Contract

- `bindSelfLaunchRuntime` requires non-empty native session id and start token supplied by the adopter.
- The protocol address must already exist and remain active; binding never creates or retires it.
- Rebinding requires the runtime binding generation and therefore fences a restarted native runtime.
- `resolveSelfLaunchRuntime` is a read and returns `null` when no native runtime is attached.
- `unbindSelfLaunchRuntime` leaves the protocol address and pending messages untouched.
- Native lifecycle and adapter acceptance checks remain outside this package.

## Proof boundary

The package test proves malformed identity is rejected before a binding can be written. The installed YATU must use an
explicit fixture-native identity and prove bind, resolve, restart-generation fencing, unbind, and unchanged pending
messages. It must not call a fake process probe or treat the logical protocol session id as native identity.
