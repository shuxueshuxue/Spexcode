---
title: session protocol errors
status: active
hue: 280
desc: The closed, machine-readable failure vocabulary shared by every public protocol operation.
code:
  - packages/session-protocol/src/errors.ts
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
---
# session protocol errors

This node owns the production representation of the protocol's frozen failure vocabulary. Callers receive one
typed error carrying a stable code, while the original database failure remains available as its cause. The module
classifies only failures the contract names and leaves every other database failure in the single unclassified
category; it never turns an error into an empty result, an implicit address, or a retry with changed bytes.

The vocabulary is closed. Operation-specific modules may add context to a message, but they may not mint a new code,
collapse two contract distinctions, or expose driver-native errors as a second public failure surface.
