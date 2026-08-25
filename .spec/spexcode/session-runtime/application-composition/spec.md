---
title: session application composition
status: active
hue: 280
desc: The cached one-database composition that joins protocol, topology, events, and runtime bindings.
code:
  - packages/session-application/src/production.ts
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# session application composition

`openProjectSessionApplication` requires the absolute database path resolved by the shared self-launch precedence and
a locality precondition before it opens protocol. It caches one composition per path, initializes each component once,
and closes the shared protocol handle only when that composition closes. State/topology/event/message writes share one
synchronous transaction; post-commit callbacks are wake hints only. A lifecycle transition may accept a caller-resolved
recipient set when an adopter owns a richer delivery policy; the composition validates and enqueues that set without
interpreting relation names. Runtime identities and generation expectations are always caller supplied. Conversation sends use an explicit `enqueueConversationMessage` action: it records the
model-facing message fact in `session-events` in the same transaction as the protocol queue write. Canonical event reads go through the application's `readEvents` boundary; consumers do not import the old file timeline reader. Durable follow cursors are also owned by the application and advance monotonically in the same SQLite store; a caller without a canonical session keeps a process-local cursor. Generic protocol
messages remain opaque and do not become conversation history. The composition never reads JSON records or exposes
an opt-in compatibility switch.
Duplicate checks use the event store's scoped message lookup rather than replaying the session history. Generic protocol
messages remain opaque and do not become conversation history. The composition never reads JSON records or exposes an
opt-in compatibility switch. State replay folds `session.state.changed.v1` and passes over the conversation message
fact recorded beside it; migrated legacy history carries its own ignorable types and is skipped by the same fold.

Lifecycle transitions resolve watcher recipients by their durable channel: a `watch:parent` relation suppresses the
routine `active`/working transition, while `watch:manual` (and the legacy `watch` channel) opts into the complete
feed. When both channels point at one watcher, the union emits one queue item. Creation still publishes its initial
snapshot through the ordinary relation transaction; this policy applies to later transitions.
