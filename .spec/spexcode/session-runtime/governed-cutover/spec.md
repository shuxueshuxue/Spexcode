---
title: governed-cutover
status: active
hue: 280
desc: The construction ledger for the Spex governed adopter cutover — what already runs on one database authority, what that landing never gated, and what the self-launch address seam still needs.
code:
  - docs/session-platform-m6-governed-cutover.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-runtime/application-service/production-cutin/spec.md
  - .spec/spexcode/session-runtime/self-launch-entry/self-launch-cutover/spec.md
---
# governed-cutover

This node owns the record of the governed adopter's move onto one database authority. Its first duty is to state a
landing honestly: the cutover the roadmap called M6 shipped as the production cut-in and a live migration, and has
carried every governed session since, without a ledger of its own. A milestone that ran in production before it was
gated is not undone by that order, but it is not closed by it either. The ledger therefore measures the landing after
the fact — which legacy readers and writers are gone from source and from the live store, which fences were kept on
purpose, which roots survive with no caller — and records the gates that never ran as open, not as passed.

The second duty is direction. Self-launch reaches the message path through the protocol address it already owns, not
through a governed record; giving it a record would make it governed, which the runtime composition forbids. What the
seam still lacks is a producer that accepts a bare address and a receive verb the recipient runs itself. The decision
that made receipt the caller's job is recorded as settled; the three decisions that shape the producer, the receive
verb, and the adoption gate are recorded as open and are not made here.

A proof that no longer runs green is the same as no proof. Two scripts this ledger inherited assert contracts that a
later decision replaced, and neither sits on a path anything executes, so they stayed red unnoticed. The ledger names
them, attributes each to the change that outdated it, and adopts one rule: a proof a ledger cites is either on an
executed path or carries the commit it was last green at.

Facilities kept for a reason are kept by name. An external-effect fence around an adapter handover is not a queue
lock, a root with no caller is residue for the demolition milestone rather than a live dependency, and a hook's own
state directory is governance state rather than message state. Each is classified once, with its callers, so the final
audit inherits categories instead of a list of survivors.
