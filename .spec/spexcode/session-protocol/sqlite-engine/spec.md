---
title: sqlite-engine
status: active
hue: 280
desc: Frozen M2 engine details for the session protocol — minimum SQLite version, connection gates, exact DDL, canonical message bytes, open-path policy, migration mechanics, and stable error codes.
code:
  - docs/session-protocol-sqlite-engine.md
related:
  - .spec/spexcode/session-protocol/spec.md
  - docs/session-architecture-concept-map.md
  - spikes/sqlite-m2/engine.mjs
  - spikes/sqlite-m2/test/engine.test.mjs
  - spikes/sqlite-m2/test/concurrency.test.mjs
  - spikes/sqlite-m2/stubs/build.mjs
  - spikes/sqlite-m2/README.md
---
# sqlite-engine

[[session-protocol]] fixes the adapter-neutral language and transaction semantics. This node owns the layer
directly beneath it: the exact SQLite engine details an implementation must reproduce byte for byte. It
governs one document, which is the contract itself; the spike is executable evidence, not the product.

The engine contract closes implementation items the architecture review deliberately left open. It never
widens the protocol vocabulary, adds an operation, or reopens a decision frozen above it. Adding an outbox,
a keyed replay dispatcher, an observer correctness path, or a cross-database fallback stays out of scope
regardless of what the engine details say.

## What the contract fixes

A minimum SQLite version, stated as an exact number with its primary source rather than a range. The
protocol's own deployment shape — several processes writing one WAL database concurrently — is the exact
trigger condition for the WAL-reset corruption bug, so the version gate is a startup refusal, not advice.
The gate compares version components numerically; a string comparison would accept builds sixteen years too
old.

A mandatory per-connection PRAGMA set, **and its order**. Each PRAGMA is asserted by reading the value back,
because setting one and not checking it is how a database silently ends up in the wrong mode. The busy
timeout is established before any other statement: it defaults to zero, so anything issued earlier runs with
no busy handler and loses a contended lock immediately. Changing journal mode is the one statement the busy
handler does not cover, so the mode is read before it is set and only a genuine first-open collision is
retried, within the caller's budget. Opening is not otherwise lock-free either, and the open-time
inspection shares that same bounded retry; runtime operations are never retried, because only startup is
transient in this way. No integrity scan runs at open: its cost grows with the database while an open does
not, and a thin CLI opens once per hook event.

The exact DDL, with each constraint and each index justified by a measured behaviour rather than by
symmetry. `STRICT` is a storage guarantee, not input validation — it silently coerces a bound number into a
text column — so every value is type-validated in memory before binding and the table constraints are a
backstop against direct writers. Timestamp ordering is never a constraint, because wall-clock time can step
backwards and would turn a valid retirement into a constraint violation; ordering authority is the enqueue
sequence alone. An index is declared only with a plan and a timing that show it earns its place, and the hot
statements pin their index explicitly: the protocol's bounded-lock-hold claim must be a property of the
schema, not of whether anyone collected planner statistics.

A protocol address is one opaque identifier, globally unique within one database path, under a single-column
primary key. The protocol has no project dimension and no composite key; an adopter sharing one database
across projects guarantees whole-database uniqueness itself, by encoding its namespace into the identifier.
The identifier grammar admits that namespacing while making path traversal structurally impossible, and it
forbids a leading dash because the frozen adoption story passes identifiers as command-line arguments.

Message identity belongs to the protocol, not the producer. A producer-minted identifier folded into the
immutable hash punishes honest retry — a producer that crashes and retries mints a fresh identifier, the
bytes differ, and a semantically identical replay is rejected as a conflict — and it creates a second
idempotency mechanism beside the idempotency key. The payload hash covers a length-prefixed binary preimage
rather than JSON, so no implementation has to agree about escaping, key order, or Unicode normalisation;
ordering within it is defined on bytes, because a host language's default string order can differ from byte
order. The body is opaque bytes and never a string, so the protocol never chooses an encoding on the
producer's behalf.

An open path is absolute and is consulted for nothing else. A relative path is refused without being
resolved, so the working directory is never read. Paths are not canonicalised, because SQLite keys its locks
on the inode and two paths to one file already observe one committed state. The database file is created;
its parent directory is not. That is the protocol's own rule about misspelled addresses applied to paths: a
misspelled directory must not produce a plausible empty protocol at the wrong location.

Migrations are component-scoped and forward-only, and each checksums only its own bytes, so appending one
never reports false drift on every existing database. All pending migrations for a component commit in one
transaction, and the existence check happens inside that same transaction, so concurrent first-openers
converge instead of replaying DDL. Verification runs before any protocol read or write. A schema the
registry does not account for is its own loud condition, distinct from a future generation.

The error inventory is a stable set of code strings with an explicit list of what may never be degraded.
Corruption, write contention, unknown and retired addresses, idempotency conflicts, and schema failures must
never surface as an empty list, a null, an implicit initialize, or a silent retry with changed bytes.
Exactly one condition yields null: an empty queue on a known active address. Reads are the deliberate
exception to retirement being terminal, because the tombstone and history stay auditable.

A consumer that needs a stronger downstream guarantee than at-most-once delivery owns a handler journal
keyed by message identifier, in its own tables, outside the protocol schema and outside any protocol lock.
The contract is fixed here; the implementation is not, and the journal never becomes an acknowledgment state
on the queue.

## Evidence standard

Every version, PRAGMA result, and constraint behaviour in the contract is measured, never recalled. A
version number without a citable primary source is recorded as evidence-needed rather than asserted, and a
guard that could not be exercised against real conditions is named as an evidence gap rather than presented
as coverage.

Each frozen decision carries an executable counter-example: a deliberately wrong implementation, a minimal
edit away from the reference, that makes a named vector fail with its own assertion. A failure that would
look identical whether the implementation is right or wrong — a missing module, a mistyped path — proves
nothing about a decision and does not count. The counter-example runner refuses to score a stub that fails
to load, so a measurement that did not happen can never be mistaken for a measurement that found nothing.

Claims that only appear across processes are proved across processes: the first-open race, delivery
exclusivity under concurrent consumers, and a cursor never skipping a committed message.

## Boundaries

The choice of SQLite binding is not fixed here. The contract is the schema, the migration registry, the
canonical encoding, the error codes, and the version gate; a binding is a replaceable implementation of it,
and any candidate must pass the identical vectors without changing a byte of the schema. Which binding ships
moves the fleet's interpreter floor, which is a decision above this node; the contract carries complete
comparative measurements for both candidates and marks the choice as pending.

One constraint on bindings does belong here: a binding is a process-global commitment. Two different SQLite
builds linked into one process against one database cannot see each other's locks, because advisory locks
are per-process, and single-writer is silently lost. Across processes the same builds interoperate exactly
as SQLite promises.

Sweep cadence, retention and purge, backup operational policy, planner-statistics maintenance, write-ahead
log growth under sustained load, network-filesystem detection on platforms that report no usable filesystem
identity, and whether the shared transaction seam admits dequeue all remain open, each with the missing
evidence named.
