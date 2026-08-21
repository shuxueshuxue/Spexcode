---
title: session application service
status: active
hue: 280
desc: Stage 1 adopter-owned notification transaction facade over protocol and optional topology.
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
---
# session application service

At this base, the application service is the Stage 1 notification transaction facade above the protocol and optional
topology packages. It owns no new durable authority. Its job is to turn one adopter notification action into one
synchronous protocol transaction: optionally mutate a topology edge, resolve the deterministic recipient set, and
enqueue the complete immutable messages before commit.

The final state → event → watcher application service remains planned. That later service may compose an
adopter-owned state store with [[session-events]] and this notification facade, but the current package does not apply
state, append events, or own a projection.

## Responsibility

`notifyRecipients(subjectSessionId, message)` resolves the current topology recipients and enqueues one copy of
the supplied message for each recipient. `attachAndNotify(fromSessionId, subjectSessionId, relationType, message)`
attaches one edge, resolves the subject's recipients after the mutation, and enqueues the same message for each
recipient. Both return the edge (when one was created), the recipient addresses, and the messages committed by the
transaction. An empty recipient set is a successful no-op after any requested topology mutation.

The Stage 1 service accepts opaque protocol message bodies and does not inspect lifecycle, harness, event, or runtime
fields. The caller chooses the message kind, body, headers, sender, and idempotency key. The service does not
invent an event log, replay cursor, wake mechanism, callback, outbox, or consumer acknowledgement.

## Transaction and failure contract

Every operation uses `protocol.withTransaction`. Topology mutation, recipient resolution, and all `tx.enqueue`
calls are inside that one transaction. If validation, topology, or enqueue fails, the relation and every message
roll back together. No adapter, network call, runtime binding lookup, or user callback runs inside the transaction.
The service never calls protocol `dequeue`; delivery remains a runtime-owned operation after commit. It is not the
final state → event → watcher application service and does not claim a Spex or ZSwarm production importer.

`session-application` imports protocol and topology. Protocol and topology never import it. Topology remains usable
without the service, and self-launch may use protocol directly without topology. The service is not a replacement for
runtime bindings, lifecycle state, event persistence, or harness materialization.

## Proof obligations

1. A real consumer can attach a parent/subject relation and observe one durable message at every recipient after the
   process exits.
2. A forced error after the relation mutation but before commit leaves no edge and no pending message.
3. A recipient set is resolved inside the transaction; no later read or callback can change the committed result.
4. The package's dependency graph contains protocol and topology only, with no Spex lifecycle or harness package.
