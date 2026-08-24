---
title: session-runtime-adopter-cutin
status: active
hue: 280
desc: Current-state minimum API contracts reverse-derived from the real self-launch and Spex governed entrances, with ZSwarm explicitly unproven at this base.
code:
  - docs/session-adopter-cutin-plan.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-protocol/spec.md
---
# session-runtime-adopter-cutin

This node owns the current-state adopter cut-in plan. It records the smallest protocol, topology transaction, runtime
adapter, configuration, journal, and wake-hint composition that each reference adopter needs without adding product
semantics to the protocol. The plan is evidence-led: self-launch and Spex governed were proven by spike fixtures
recorded in git history;
ZSwarm has no production importer in this repository and therefore has no executable adopter proof at this base.

The plan freezes the following adopter-facing consequences: protocol `session_id` is globally unique within one
adopter database, `project_id` remains Spex-owned metadata rather than protocol scope, `dequeue` is at-most-once, and
post-dequeue retry belongs to a consumer journal keyed by `messageId`. Storage locality is an adopter precondition:
the path resolver establishes that the resolved absolute database sits on a local filesystem with reliable advisory
locking before opening the protocol, and fails closed when locality is non-local or undetermined. The protocol core
neither performs nor simulates that judgement. The consumer handler journal stays outside the protocol and outside the dequeue
transaction, so an adapter that keeps one may not present it as protocol-level at-least-once and owns its own
crash and retry proof. Sender revocation, cursor restart semantics, native identity, lifecycle, and adapter
results remain adopter-owned decisions; they are not protocol operations.

Those fixtures were temporary absolute-database experiments and no longer ship in this tree; their fail-first and
passing outputs are reachable through git history at the commits their readings name. They never imported production
adopters or authorized changes to the legacy files; the production cutovers still require sabotage, YATU, one-way
migration, and physical deletion at the milestones named by the architecture ledger.
