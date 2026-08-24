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
---
# sqlite-engine

[[session-protocol]] fixes the adapter-neutral language and transaction semantics. This node owns the layer
directly beneath it: the exact SQLite engine details an implementation must reproduce byte for byte. It
governs one document, which is the contract itself. The M2 spike that produced its figures was executable
evidence, never the product, and no longer ships in this tree; it is reachable only through git history.

The engine contract closes implementation items the architecture review deliberately left open. It never
widens the protocol vocabulary, adds an operation, or reopens a decision frozen above it. Adding an outbox,
a keyed replay dispatcher, an observer correctness path, or a cross-database fallback stays out of scope
regardless of what the engine details say.

## What the contract fixes

A journal mode, and a minimum SQLite version derived from it. V1 uses a rollback journal and never enters
write-ahead logging. The mode is asserted on every connection and never set: a fresh database already
reports it, so there is nothing to change, and a database left in write-ahead logging is refused rather than
converted, because a runtime dual path is exactly what this refactor removes. Never issuing a journal-mode
change also removes a whole hazard class, since a mode change is not covered by the busy handler in either
direction.

Declining write-ahead logging is what makes the version floor small. The corruption bug that would otherwise
force a floor above what the deployed interpreters ship affects only that mode, so the floor is instead
derived from the SQL features the schema actually contains, each traced to the release that introduced it.
The binding constraint is the release that made the JSON functions built-ins, because depending on an
earlier one would mean depending on how somebody compiled their SQLite, and a compile-time flag is not a
version floor. The gate compares version components numerically; a string comparison would accept builds
years too old. A vector exercises every feature the floor is derived from, so the floor is tested rather
than asserted.

The mode is not free, and the contract accounts for its cost rather than presenting it as a pure
simplification. A rollback journal serialises more: a reader no longer blocks nothing, and an adopter
holding a long read transaction stalls every writer on that database. Write throughput drops severalfold.
Both are measured, and the milestone's throughput bar is confirmed against the mode actually shipped rather
than the one measured first.

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

Storage locality is a stated safety precondition rather than a protocol capability. The database must sit on
local storage with reliable advisory locking, and the adopter's path resolver establishes that before the
protocol is opened, failing closed whenever locality cannot be positively determined — an unrecognised
filesystem, a platform with no detector, or a probe that cannot answer all mean refusal, never optimistic
acceptance. The protocol core does not probe the filesystem, and must not appear to: choosing a rollback
journal removed the automatic refusal that write-ahead logging provided for free by requiring shared memory
between processes. A rollback journal works over a network filesystem without complaint while advisory
locking there is unreliable, which converts a loud failure into silent corruption. Nothing in this contract
may be read as evidence that the journal choice makes network storage safe; the opposite is true, and that
is why the guarantee is made explicitly and upstream.

Crash recovery is a property of the journal, so it is measured against the journal actually used. A process
killed before its commit leaves work invisible to every later reader; a process killed after its commit
keeps the message and never requeues it. The recovery record left on disk is consumed by the next write
rather than by an open or a read, so its presence is not corruption, not danger, and not data — it belongs
to the database engine exactly as the write-ahead files did.

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
on the queue. The same-database transaction seam does not admit a dequeue: it spans a topology mutation and
the enqueues that mutation requires, and nothing more. A consumer therefore cannot make its journal write
atomic with taking a message, so dying between the two loses the record that handling was owed. That cost is
chosen rather than overlooked, and no adopter may present its own journal as protocol-level at-least-once. A
crash fixture holds the line: a handler killed after its dequeue commits never sees the message offered
again, and a counter-example whose dequeue skips the state transition makes that fixture fire.

## Evidence standard

Every version, PRAGMA result, and constraint behaviour in the contract is measured, never recalled. A
version number without a citable primary source is recorded as evidence-needed rather than asserted, and a
guard that could not be exercised against real conditions is named as an evidence gap rather than presented
as coverage.

Measurements are bound to the design that produced them. When a ruling changed the journal mode, every
concurrency, throughput, and crash figure taken under the previous mode became historical rather than
current, and was re-measured rather than carried across. The superseded evidence is kept verbatim, because
it is what the ruling was decided on, and the contract labels which era each figure belongs to.

Each frozen decision carries an executable counter-example: a deliberately wrong implementation, a minimal
edit away from the reference, that makes a named vector fail with its own assertion. A failure that would
look identical whether the implementation is right or wrong — a missing module, a mistyped path — proves
nothing about a decision and does not count.

A counter-example must also be repeatable. One that fires most of the time is not a gate, and recording it
as though it were is how a hard invariant can sit unguarded while looking guarded: two honest runs of the
same code then disagree, and whichever ran first becomes the record. A decision is gated only when the
wrong implementation is caught every time and the right one passes every time, which means a vector whose
outcome depends on a race has to be rebuilt around a condition the test controls rather than observes. When
no repeatable counter-example can be built, the invariant is demoted to a measured recommendation and says
so; an unguarded assertion presented as a gate is the one outcome not permitted.

The same rule applies to a vector that has always passed. A test whose pass depends on timing it does not
control is reporting the timing, not the property, and it will keep reporting success until something
unrelated slows down. Two such vectors were found here only because an unrelated change made writes slower;
both terminated on a wall clock and were rebuilt to terminate on the condition they actually assert. The counter-example runner refuses to score a stub that fails
to load, so a measurement that did not happen can never be mistaken for a measurement that found nothing.

Claims that only appear across processes are proved across processes: the first-open race, delivery
exclusivity under concurrent consumers, and a cursor never skipping a committed message.

## Boundaries

The binding is fixed, but fixing it does not make it the contract. The contract is the schema, the
migration registry, the canonical encoding, the error codes, and the version gate; a binding is a
replaceable implementation of them, and any candidate must pass the identical vectors without changing a
byte of the schema. That replaceability is measured rather than asserted, by running the same vectors
through a second binding and confirming the migration text hashes identically under both.

One constraint on bindings does belong here: a binding is a process-global commitment. Two different
database builds linked into one process against one file cannot see each other's locks, because advisory
locks are per-process, and single-writer is silently lost. Across processes the same builds interoperate
correctly.

Write-ahead logging is deferred, not forbidden forever. It stays outside this contract with its own stated
preconditions — a version floor high enough to clear the corruption bug on every participating process, a
locality guarantee at least as strong as the one above, and a migration path for databases this contract
refuses to convert. It must never arrive as a configuration flag or a runtime branch on this contract.

Sweep cadence, retention and purge, backup operational policy, planner-statistics maintenance, the effect of
reader-blocks-writer under realistic adopter load, locality detection on platforms that report no usable
filesystem identity, verification of the network-filesystem verdicts against a real mount, and whether the
shared transaction seam admits dequeue all remain open, each with the missing evidence named.
