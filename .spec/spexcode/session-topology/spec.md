---
title: session-topology
status: active
hue: 280
desc: The relation model for opaque session addresses; it resolves associations and recipients without storing or delivering messages.
---
# session-topology

Session topology is a sibling of [[session-protocol]], not a layer inside it. It owns durable relationships among
opaque session ids: parent/child attachment, detach, reparent, explicit subscriptions, cycle refusal, and the
recipient set implied by one relation change. It neither opens `pending.json` nor knows how a harness runs.

The topology vocabulary is `attach`, `detach`, `reparent`, `parents`, `children`, `subscribe`, `unsubscribe`, and
`recipients`. A parent notification is composition, not a protocol verb: the runtime asks topology for recipients,
builds a fixed message, then calls protocol `enqueue` for each exact address. The same topology operation may be
used without sending anything.

Relationship revision and notification publication require an adopter-owned durable outbox or keyed replay. The
topology module supplies stable relation/revision identity; [[session-runtime]] reconciles each intended recipient
through protocol enqueue. A file observer is never the missing transaction between a relation write and a message
write.

The first implementation stays internal until at least Spex governed sessions and Z-Storm demonstrate that they
share the same relationship semantics rather than merely similar field names. Only then should it become a
published `@spexcode/session-topology` package. Self-launch proves the opposite boundary: it may use the protocol
with no topology at all.

Spex-specific parent watch sources (`manual`/`parent`), initial-working suppression, proposal/actionable policy,
board scope, and manager handoff are product topology policy above this neutral relation model. Z-Storm task roles,
root/worker declaration rules, and swarm status projection are likewise Z-Storm policy.
