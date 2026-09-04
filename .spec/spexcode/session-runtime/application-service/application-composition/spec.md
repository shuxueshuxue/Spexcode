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
model-facing message fact in `session-events` in the same transaction as the protocol queue write. Canonical event reads go through the application's `readEvents` boundary; consumers do not import the old file timeline reader. Durable follow cursors are also owned by the application and advance monotonically in the same SQLite store; a caller without a canonical session keeps a process-local cursor. Managed watch delivery belongs to the backend that owns the watcher's control channel: it polls the global event store by durable watch edge and cursor, then enqueues and hands over after the read transaction commits. Generic protocol
messages remain opaque and do not become conversation history. The composition never reads JSON records or exposes
an opt-in compatibility switch.
Duplicate checks use the event store's scoped message lookup rather than replaying the session history. Generic protocol
messages remain opaque and do not become conversation history. The composition never reads JSON records or exposes an
opt-in compatibility switch. State replay folds `session.state.changed.v1` and passes over the conversation message
fact recorded beside it; migrated legacy history carries its own ignorable types and is skipped by the same fold.

Lifecycle transitions record the subject event only. The owner-side watch poll resolves watcher recipients by their durable channel: a `watch:parent` relation suppresses the
routine `active`/working transition, while `watch:manual` opts into the complete feed. A migrated `watch` channel
is normalized by the importer. When both channels point at one watcher, the union emits one queue item. The poll reads a batch, commits, enqueues and attempts transport, then advances the cursor in a separate short transaction; event ids are idempotency keys, giving at-least-once delivery without duplicate prompts after a crash. A backend restart resumes from the durable cursor. Creation still publishes its initial
snapshot through the ordinary relation transaction; this policy applies to later transitions.
