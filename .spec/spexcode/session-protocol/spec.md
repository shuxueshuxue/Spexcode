---
title: session-protocol
status: active
hue: 280
desc: The published, adapter-neutral file protocol for durable session messages, timelines, cursors, and cross-process exclusion.
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
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/sessions.ts
---
# session-protocol

`@spexcode/session-protocol` is the published package for one closed, file-backed communication language. The
current `@spexcode/session-core` package is its compatibility predecessor; during migration it may re-export the
new public entry, but it must not remain a second protocol or gain new vocabulary.

The package answers only this question: **what messages exist for one exact session address, and which of them
have been removed from its queue?** It does not know why that session exists, whether it is governed, who its
parent is, which harness runs it, or what a consumer does after receiving a message.

## Fixed language

The public nouns are `session`, `message`, `queue`, `timeline`, `journal`, `cursor`, `producer`, and `consumer`.
Every operation belongs to a protocol instance opened with an explicit absolute `sessionRoot`. The directory below
that root has one fixed, versioned wire layout; the package does not know Git, a project root, `.spexcode`, or any
product-global configuration file. This prevents a multi-workspace runtime from routing sessions through its
process `cwd` and lets every adopter choose where protocol state lives without forking the protocol. A product may
offer a current-project convenience wrapper, but that wrapper resolves and passes the exact root before opening the
protocol.

The public operations are:

- `initialize(sessionId)` establishes an exact protocol address below the instance's explicit `sessionRoot`. It is
  valid without a governed lifecycle record, a board row, a backend, or a running harness. It atomically publishes
  the universal versioned `session.json` identity record. Enqueue never silently initializes an unknown target, so
  a misspelled id cannot create a plausible inbox.
- `enqueue(sessionId, message)` durably records one immutable message and appends it to that session's FIFO
  queue. An `idempotencyKey`, when present, binds to the complete immutable message bytes; exact replay returns
  the first result and changed reuse fails loudly.
- `dequeue(sessionId)` atomically removes and returns the FIFO head, or returns `null` when the queue is empty.
  `drain` is only the ordinary repeated-dequeue convenience; it has no harness callback.
- `listPending(sessionId)` returns the current ordered messages without changing them. `hasPending` is the cheap
  boolean form.
- `readTimeline(sessionId, cursor?)` reads immutable history without changing queue state. Cursor operations are
  monotonic reader state, never delivery state.
- `reconcile(sessionId)` repairs interrupted protocol writes from the journal and fails loudly on bytes whose
  authority cannot be proved.

Do not expose overlapping words for the same state. In particular, `take`, `claim`, `accept`, `owed`, `taken`,
`settled`, and `delivered` are not protocol operations. A product may use those words above this boundary, but
the file language remains `enqueue` and `dequeue` everywhere.

A message has a protocol version, `messageId`, `targetSessionId`, optional `senderSessionId`, body, optional string
headers, and an optional `idempotencyKey`. Product-specific facts such as lifecycle, proposal, reply transport,
native thread id, or ZSwarm task state may be encoded by the producer in a versioned message kind and headers;
the protocol stores and compares them but never interprets them.

## Closed file system

Each initialized session address owns five logical durable artifacts below the protocol instance's explicit
`sessionRoot`:

- `session.json`, the immutable universal identity record containing only schema version, exact session id, and
  creation time;
- the immutable `timeline`, which says what was recorded;
- `pending.json`, the small FIFO work list;
- the private delivery `journal`, which is the crash authority for enqueue and dequeue;
- `cursors.json`, which records independent timeline readers.

Cross-process locks live outside the removable session directory, so a stale writer remains fenced while an
address is retired. Every queue mutation, including ordinary unkeyed enqueue, uses the same queue lock; cursor
writes use their own lock. Every whole-file mutation uses atomic replace. A malformed identity record,
queue, journal, or cursor is an error, not an empty state: treating corrupt bytes as no work is silent message
loss.

The journal makes the two queue transitions deterministic. Enqueue first records immutable authority and then
publishes the pending row; reconcile restores a missing row from that authority. Dequeue records the message as
removed before deleting the pending head; reconcile deletes any crash-left copy. A process that dies after the
dequeue commit but before its caller handles the returned value does not cause requeue. That is the deliberate
protocol boundary: **successful dequeue is protocol delivery**, while rendering a prompt, steering a native
thread, awaiting a model, and obtaining a reply are consumer behavior. A consumer needing a stronger downstream
guarantee keeps its own handler journal keyed by `messageId`; it does not extend this queue with adapter-aware
acknowledgment states.

No filesystem notification is correctness authority. A producer may issue an in-process wake hint, a runtime may
poll, and a UI may use an observer to reduce latency, but every wake path re-reads durable state. Missing,
coalesced, duplicated, or delayed `fs.watch` events therefore affect only latency. A backend that was absent for
hours simply finds the same pending rows when it starts; a self-launched agent may run an explicit listener that
does the same.

## Boundaries

Governed lifecycle fields currently stored in SpexCode's monolithic `session.json`, governance, parent/child edges,
watch policy, sender revocation policy, launch, stop, liveness, tmux, sockets, native RPC, prompt composition, and
materialized harness files are outside this package. The target `session.json` is not an extension container for
those fields: it is the immutable universal identity record, while each adopter state module owns its own writes.
The package must not import a harness adapter or a topology implementation. `session-protocol` and
[[session-topology]] are sibling foundations; [[session-runtime]] is the composition layer that may import both.

The package does not depend on `spec-core` for storage placement. SpexCode's adopter resolves its global state
root and project namespace, then passes the resulting session directory to this package. Another adopter may use
a different configuration system and directory without changing any protocol operation or file below that root.
The public package entry exposes complete protocol operations and read models. Raw locks, journal codecs, queue
replacement, revocation, and partial transaction helpers remain private; an external adopter must never
reconstruct an enqueue or dequeue from half-operations.

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
adapter result, the composition is wrong. If all three need the same file transaction or recovery rule, that rule
belongs here.
