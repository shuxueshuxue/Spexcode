---
title: session events
status: active
hue: 280
desc: A same-database append-only fact stream with deterministic ordered reads and explicit unknown-event handling.
code:
  - docs/session-events-plan.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/session-events-package/spec.md
  - .spec/spexcode/session-runtime/session-events-store/spec.md
  - .spec/spexcode/session-runtime/session-events-schema/spec.md
  - .spec/spexcode/session-runtime/session-events-errors/spec.md
  - .spec/spexcode/session-runtime/session-events-yatu/spec.md
  - .spec/spexcode/session-protocol/spec.md
---
# session events

`session-events` is a small component over one `session-protocol` database. It stores canonical facts that have
already happened. The application layer decides what a fact means, appends it in the same synchronous protocol
transaction as any required state mutation and message enqueue, and owns projections derived from those facts.

## Durable contract

- Each event belongs to one exact existing protocol session address. Its `eventSeq` is contiguous from one within
  that subject stream; interleaved subjects do not create gaps in one another.
- An event has a caller-owned 32-hex `eventId`, bounded `type`, positive integer `schemaVersion`, boolean `ignorable`,
  exact payload bytes, and a non-negative occurrence time. The store snapshots payload bytes before insert and returns
  fresh byte buffers on reads, so later caller mutation cannot rewrite history.
- Rows are append-only. Correction is another event, never `UPDATE` or `DELETE` of an existing fact.
- Ordered reads validate the stored sequence instead of trusting it. A missing, duplicate, or out-of-order sequence is
  storage corruption and fails loudly.
- Replay is a left fold over that ordered byte stream. An event type with a reducer is applied. An unknown required
  event fails; an unknown event is skipped only when its own durable envelope says `ignorable: true`.
- Component schema is installed through `session-protocol` component migrations. The protocol schema and API do not
  learn event fields and the event package never opens a second SQLite connection.

## Boundary of deterministic replay

The package guarantees the persisted event envelope, exact bytes, sequence validation, range selection, and fold
order. It cannot make a caller reducer pure, pin application code, resolve content-addressed artifacts, or prove that
two code versions interpret a schema identically. Those are application/adopter proof obligations. Replay reconstructs
state only; it never retries a provider call, filesystem write, Git operation, delivery, or other external side effect.

The store therefore exposes raw ordered `read` and generic `replay` rather than owning a Spex or ZSwarm
`SessionProjection`. It is not a general event-sourcing framework, outbox, observer bus, wake mechanism, command log,
protocol delivery replacement, or runtime lifecycle record.

## Required proof

Package tests must prove per-subject contiguous sequences, rollback with the surrounding protocol transaction,
append-only triggers, caller byte mutation isolation, unknown required rejection, and unknown ignorable skipping. A
repository-external installed consumer must pack protocol and events, append a fact plus its protocol reference in one
transaction, close/reopen the database, and reconstruct a projection through public exports only.
