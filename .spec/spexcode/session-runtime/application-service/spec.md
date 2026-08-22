---
title: session application service
status: active
hue: 280
desc: Adopter-owned production composition for durable session state, topology, events, watcher publication, and runtime bindings.
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
code:
  - packages/session-application/src/index.ts
related:
  - .spec/spexcode/session-runtime/application-state-schema/spec.md
  - .spec/spexcode/session-runtime/application-composition/spec.md
  - .spec/spexcode/session-runtime/application-consumer-yatu/spec.md
---
# session application service

The application service is the adopter-owned production composition above protocol, topology, events, and runtime
bindings. One composition is opened for one absolute database path selected by the self-launch resolver and one
positively established local filesystem locality verdict. It opens each component once, owns a small state table,
and never invents a path or a native identity. SQLite is the sole authoritative state, event, topology, and watcher
store; there is no runtime compatibility mode or JSON read fallback.

## Responsibility

`createSession`, `transitionSession`, `enqueueMessage`, `attachWatcher`, and `detachWatcher` initialize exact protocol
addresses and mutate the service state/topology/recipient queue in one synchronous transaction. `enqueueMessage` is the only
adopter-facing direct delivery action; consumers do not reach through the service to call protocol `enqueue`.
A parent/child transition appends a typed event before resolving
durable watcher recipients and enqueueing immutable notifications. The commit result is returned only after the
transaction commits; an optional post-commit notifier receives that result as a wake hint and is never part of the
transaction. `bindRuntime` requires the adopter-supplied harness kind, native id, and start token and forwards the
binding generation fence. A stale generation fails loudly.

The original `notifyRecipients` and `attachAndNotify` operations remain as small protocol/topology-only helpers for
callers that do not use lifecycle state. They share the same transaction boundary but do not claim a state event.

The package entry also exposes the pure `jsonMigrationFencePath(recordsRoot)` path helper. It is shared by the
one-time importer and the legacy writer gate so both sides name exactly the same durable cutover fence; it does not
open a database, read session state, or provide a compatibility path.

State events use the closed `session.state.changed.v1` envelope with JSON payload bytes, including the lifecycle
proposal and note fields. Replay folds the append-only
event stream on restart and validates sequence gaps and unknown required event types through [[session-events]].
Successful dequeue remains the protocol transfer boundary; runtime binding resolution occurs before dequeue and is not
an acknowledgement or a second queue.

## Transaction and failure contract

Every state operation uses `protocol.withTransaction`. State mutation, topology mutation, event append, recipient
resolution, and all `tx.enqueue` calls roll back together. No adapter, network call, locality probe, runtime callback,
or user callback runs inside the transaction. Post-commit notification is a best-effort wake hint over already
durable messages. The service never calls protocol `dequeue` for a consumer.

`session-application` imports protocol and topology. Protocol and topology never import it. Topology remains usable
without the service, and self-launch may use protocol directly without topology. The service is not a replacement for
runtime bindings, lifecycle state, event persistence, or harness materialization.

## Proof obligations

1. A real consumer can create a parent and child, attach a watcher, observe a typed state event, close and reopen the
   backend, replay the event, publish one durable notification, and receive it in the watching session.
2. A forced error after state/topology mutation but before commit leaves no state, edge, event, or pending message.
3. Missing or relative database paths and a failed locality precondition refuse before any component opens.
4. Native identity is never inferred; a stale binding generation is rejected and cannot replace the current binding.
5. A migrated session has state, topology, events, and watcher facts in SQLite; a missing application row is a loud
   unmigrated/corrupt condition, never a legacy projection.
