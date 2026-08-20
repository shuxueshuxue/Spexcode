---
title: session-topology
status: active
hue: 280
desc: The relation model for opaque session addresses; it resolves associations and recipients without storing or delivering messages.
related:
  - .spec/spexcode/session-topology/topology-schema/spec.md
  - .spec/spexcode/session-topology/topology-errors/spec.md
  - .spec/spexcode/session-topology/topology-package-entry/spec.md
---
# session-topology

Session topology is a sibling of [[session-protocol]], not a layer inside it. It owns durable relationships among
opaque session ids: parent/child attachment, detach, reparent, explicit subscriptions, cycle refusal, and the
recipient set implied by one relation change. It neither opens `pending.json` nor knows how a harness runs.

The topology vocabulary is `attach`, `detach`, `reparent`, `parents`, `children`, `subscribe`, `unsubscribe`, and
`recipients`. A parent notification is composition, not a protocol verb: the runtime asks topology for recipients,
builds a fixed message, then calls protocol `enqueue` for each exact address. The same topology operation may be
used without sending anything.

V1 topology and protocol state share one adopter-owned SQLite database. When adopter policy requires notifications,
the relation mutation and all deterministic protocol enqueues commit in one bounded synchronous transaction or all
roll back. There is no transactional outbox, relation-revision replay, dispatcher, or observer bridging the two
writes. Cross-database publication, an external broker, and network delivery are outside v1; adding one would
require a new contract rather than a fallback inside this topology.

The first implementation stays internal until at least Spex governed sessions and ZSwarm demonstrate that they
share the same relationship semantics rather than merely similar field names. Only then should it become a
published `@spexcode/session-topology` package. Self-launch proves the opposite boundary: it may use the protocol
with no topology at all.

Spex-specific parent watch sources (`manual`/`parent`), initial-working suppression, proposal/actionable policy,
board scope, and manager handoff are product topology policy above this neutral relation model. ZSwarm task roles,
root/worker declaration rules, and swarm status projection are likewise ZSwarm policy.
