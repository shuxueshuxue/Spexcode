---
title: session-protocol
status: active
hue: 280
desc: The published, adapter-neutral SQLite protocol for durable session messages, FIFO delivery, history, and cross-process transactions.
code:
  - packages/session-core/src/index.ts
related:
  - docs/session-architecture-concept-map.md
  - packages/session-core/src/runtime-session.ts
  - packages/session-core/src/internal.ts
  - packages/session-core/src/message.ts
  - packages/session-core/src/record-lock.ts
  - packages/session-core/src/session-timeline.ts
  - packages/session-core/src/session-cursors.ts
  - packages/session-core/src/delivery-queue.ts
  - packages/session-core/src/session-protocol.test.ts
  - packages/session-core/scripts/public-boundary.test.mjs
  - packages/session-core/package.json
  - packages/session-core/tsconfig.build.json
  - packages/session-protocol/src/errors.ts
  - packages/session-protocol/src/canonical.ts
  - packages/session-protocol/src/schema.ts
  - packages/session-protocol/src/engine.ts
  - packages/session-protocol/src/index.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/sessions.ts
---
# session-protocol

The session communication protocol has one published package and one closed, SQLite-backed language. The package
name is a distribution decision, not a second protocol identity. No predecessor package, compatibility re-export,
dual-read, dual-write, or runtime fallback is part of this contract; adopter cutover changes imports atomically and
removes the old entry.

The package answers only this question: **what messages exist for one exact session address, and which of them
have been removed from its queue?** It does not know why that session exists, whether it is governed, who its
parent is, which harness runs it, or what a consumer does after receiving a message.

## Fixed language

The public nouns are `session`, `message`, `queue`, `producer`, and `consumer`. Every operation belongs to a
protocol instance opened with an explicit absolute `databasePath`. The database has one fixed, versioned protocol
schema; the package does not know Git, a project root, `.spexcode`, a database filename, or any product-global
configuration file. This prevents a multi-workspace runtime from routing sessions through process `cwd` and lets
every adopter choose where protocol state lives without forking the protocol. A product may offer a convenience
wrapper, but that wrapper resolves and passes the exact absolute path before opening the protocol.

The public operations are:

- `initialize(sessionId)` establishes an exact protocol address. It is valid without a governed lifecycle record,
  a board row, a backend, or a running harness. Exact replay against an active address is idempotent; a retired
  address cannot be resurrected. Enqueue never silently initializes an unknown target, so a misspelled id cannot
  create a plausible inbox.
- `enqueue(sessionId, message)` durably records one immutable message and appends it to that session's FIFO
  queue. An `idempotencyKey`, when present, binds to the complete immutable message bytes; exact replay returns
  the first result and changed reuse fails loudly.
- `dequeue(sessionId)` atomically removes and returns the FIFO head, or returns `null` when the queue is empty.
- `listPending(sessionId)` returns the current ordered messages without changing them.
- `readMessages(sessionId, afterSequence?)` reads immutable history in stable enqueue sequence without changing
  queue state. Reader position is consumer-owned and is not protocol state.
- `retire(sessionId)` requires an empty queue, atomically refuses future enqueue, and retains an auditable tombstone
  and message history. Purge and retention are adopter maintenance policy, not implicit retirement behavior.

Do not expose overlapping words for the same state. In particular, `take`, `claim`, `accept`, `owed`, `taken`,
`settled`, `delivered`, `drain`, and `reconcile` are not protocol operations. A product may use those words above
this boundary, but the protocol language remains `enqueue` and `dequeue` everywhere.

A message has a protocol version, `messageId`, `targetSessionId`, optional `senderSessionId`, body, optional string
headers, and an optional `idempotencyKey`. Product-specific facts such as lifecycle, proposal, reply transport,
native thread id, or ZSwarm task state may be encoded by the producer in a versioned message kind and headers;
the protocol stores and compares them but never interprets them.

## Closed SQLite state

One application state instance uses one adopter-owned SQLite database. The protocol owns component-scoped,
checksummed migrations plus two logical relations: session addresses with active/retired state, and immutable
messages with stable enqueue sequence and one pending-to-dequeued transition. Pending FIFO is a query over message
state, not a second queue projection. Adopter and topology tables may share the database, but never extend protocol
rows with product fields.

SQLite transactions are the only protocol write and recovery authority. Application lock files, per-session JSON,
application journals, event logs, protocol outboxes, persisted reader cursors, and reconcile passes are absent.
Every write is a bounded synchronous transaction containing only SQL and pure in-memory validation; it performs no
network, Git, harness, terminal, file-copy, async, or user-callback work. Schema checksum drift, an unsupported
schema generation, corrupt storage, and exhausted write contention fail loudly rather than appearing as an empty
queue.

Enqueue inserts the immutable message and its pending state in one commit. Dequeue changes the FIFO head from
pending to dequeued in one commit. A process that dies before the dequeue commit leaves the message pending; a
process that dies after commit does not cause requeue. That is the deliberate protocol boundary: **successful
dequeue is protocol delivery**, while rendering a prompt, steering a native thread, awaiting a model, and obtaining
a reply are consumer behavior. A consumer needing a stronger downstream guarantee keeps its own handler journal
keyed by `messageId`; it does not extend this queue with adapter-aware acknowledgment states.

No wake mechanism is correctness authority. A producer may issue an in-process or cross-process wake hint and a
runtime may sweep, but every wake path queries durable state. Missing, coalesced, duplicated, or delayed hints
therefore affect only latency. A runtime that was absent for hours finds the same pending rows when it starts.

## Boundaries

Governed lifecycle fields, governance, parent/child edges, watch policy, sender revocation policy, launch, stop,
liveness, tmux, sockets, native RPC, prompt composition, and materialized harness files are outside this package.
The protocol session row is not an extension container for those fields; each adopter state module owns its own
tables and writes. The package must not import a harness adapter or a topology implementation. `session-protocol` and
[[session-topology]] are sibling foundations; [[session-runtime]] is the composition layer that may import both.

The package does not depend on `spec-core` for storage placement. SpexCode's adopter resolves its global state
root and project namespace, then passes the resulting absolute database path to this package. Another adopter may
use a different configuration system and path without changing any protocol operation or schema. The public entry
exposes complete operations and read models. A controlled synchronous transaction capability may compose
owner-specific tables and protocol enqueue in the same database; raw connections and half-operations are not a
general consumer surface, and an external adopter must never reconstruct enqueue or dequeue from partial writes.

Failures must preserve these language-neutral distinctions even if an implementation chooses different class
names: invalid or non-absolute database path, unknown session, retired session, idempotency-key conflict, non-empty
retirement, incompatible schema or migration checksum, busy write, and corrupt storage. None may be converted to
`null`, an empty list, implicit initialization, or a successful retry with changed bytes.

## M1 conformance vectors

The schema, migration set, and fixtures are portable protocol assets. Any implementation must pass the same
vectors through its public operations against a fresh temporary database:

1. Opening a relative path is rejected without reading `cwd` or product config; two processes opening the same
   absolute path observe one committed state.
2. Empty-database migration and exact migration replay converge at the schema level; changed checksum or a future
   unsupported generation fails before protocol reads or writes.
3. Initialize is idempotent for one active exact id. Enqueue to an unknown id fails and creates no address or
   message. A retired id cannot be initialized or enqueued again.
4. Enqueue `A` then `B` yields pending `[A, B]`; dequeue returns `A`, then `B`, then `null`. `readMessages` retains
   both in stable sequence and reports their dequeued state without a persisted reader cursor.
5. Replaying one idempotency key with identical immutable bytes returns the original message and creates one row;
   reusing it with any changed message byte fails with the idempotency-conflict category and changes no state.
6. Two concurrent consumers racing one pending head produce exactly one successful dequeue. Commit-before-crash
   leaves it dequeued; rollback-before-commit leaves it pending.
7. Retire with pending work fails atomically. Retire after the queue empties preserves the tombstone and history,
   and all later enqueue attempts fail as retired.
8. Opaque body bytes and headers round-trip exactly, including unknown message kinds; no topology, lifecycle,
   harness, or product field changes protocol behavior.
9. In a fixture-owned extension table, one synchronous transaction can commit an extension mutation and zero or
   more enqueues together; forced rollback leaves neither side visible. The fixture contains no outbox or replay
   dispatcher.
10. Missing every wake hint does not change durable results: a newly opened process discovers and dequeues the same
    pending rows by querying the database.

## Adoption pressure

The contract is accepted only if all three reference adopters compose without a special protocol mode:

- **ZSwarm** owns its task topology and native runtime loop. It initializes addresses, resolves recipients in
  its topology, enqueues fixed messages, and dequeues them from its own runtime process.
- **self-launch** has no governed record or resident Spex backend. Materialized hooks initialize the native
  session id; any producer may enqueue while the harness is offline; an explicit listener/monitor command later
  dequeues and hands messages to that harness's ordinary input seam.
- **Spex governed sessions** add the Spex topology, board lifecycle, and harness runtime adapter. Hook/CLI writers
  enqueue directly in their own process; the backend drains immediately or on a durable-state sweep. It may use a
  wake hint, but never needs a file observer to make a committed message discoverable.

If an adopter requires the protocol to inspect parentage, `governed`, lifecycle words, native identity, or an
adapter result, the composition is wrong. If all three need the same database transaction or recovery rule, that
rule belongs here.
