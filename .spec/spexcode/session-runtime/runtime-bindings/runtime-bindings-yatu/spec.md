---
title: runtime bindings clean consumer proof
status: active
hue: 280
desc: A real installed-consumer-shaped proof of binding, unbinding, and protocol delivery.
code:
  - scripts/runtime-bindings-yatu.mjs
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# runtime bindings clean consumer proof

The proof uses the public protocol and runtime package entry points against a temporary database. It binds an adopter
identity, leaves the protocol message pending across unbind, and then delivers it through the protocol's at-most-once
dequeue boundary. It does not inspect internal tables or use a topology helper to stand in for runtime identity.
