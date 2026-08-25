---
title: session application state schema
status: active
hue: 280
desc: The adopter-owned state projection used by the production session application composition.
code:
  - packages/session-application/src/schema.ts
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
---
# session application state schema

The application component owns one strict state row per initialized protocol address. It stores only the current
status, proposal, note, explicit parent address, and update time. State changes append the typed application event
before notifying topology recipients. Parent/child relations remain in the neutral topology component;
existing JSON records enter this table only through the one-time deterministic migration, after which JSON is never a
read source for application state. The component also owns the follow-cursor table recording, per watcher and
subject address, the last event sequence that watcher has consumed.

The migration list is this component's entire schema generation ledger, and it is append-only. A version that has
been applied to any store is never rewritten or removed, because its checksum is verified on every open. Every build
that may open a shared store carries the complete ledger, including generations whose tables it never reads: a build
whose ledger stops short refuses the store outright rather than half-understanding it, so an omitted generation locks
out every consumer of that store, not only the surface that introduced the table. Schema migration is therefore a
landed-toolchain operation: a build must verify the complete ledger before it can compose the shared store, and an
older or unlanded build fails loudly before opening the application rather than migrating a store it cannot fully read.
