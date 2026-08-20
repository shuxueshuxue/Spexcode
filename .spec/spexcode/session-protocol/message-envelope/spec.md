---
title: session protocol message envelope
status: active
hue: 280
desc: Canonical immutable message bytes and bounded in-memory envelope validation.
code:
  - packages/session-protocol/src/canonical.ts
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
---
# session protocol message envelope

This node owns the production encoding of immutable message content and the validation that makes that encoding
portable. The encoder accepts explicit bytes, orders header keys by their encoded bytes, and frames every field
without depending on object serialization conventions. Hashing is a pure operation over that canonical preimage.

Validation completes before a write begins. It bounds every producer-controlled value, rejects implicit text
encoding and producer-owned message identity, and returns a normalized envelope whose stored header order and hash
are reproducible. It does not interpret message kinds or header values.
