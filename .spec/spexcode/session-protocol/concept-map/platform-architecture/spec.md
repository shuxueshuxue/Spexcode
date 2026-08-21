---
title: session-platform-architecture-review
status: active
hue: 165
desc: The human-reviewable top-level view of the proposed SQLite-backed session platform and its three adopters.
code:
  - docs/session-platform-architecture.html
related:
  - docs/session-events-architecture.html
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/concept-map/session-management-refactor/spec.md
  - .spec/spexcode/session-protocol/concept-map/construction-roadmap/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# session-platform-architecture-review

This node owns the linked HTML review view that presents the proposed session platform as one self-contained
architecture: a fixed communication protocol, adopter-owned topology and runtime composition, separate harness
runtime and configuration adapters, explicit storage placement, and the ZSwarm, self-launch, and Spex-governed
adoption paths.

The related `docs/session-events-architecture.html` is a review artifact for the session-events and
session-application layers. It must distinguish the current protocol/topology/events-replay/runtime-seam foundation
and Stage 1 notification transaction facade from the planned state → event → watcher application service. It must not
claim Spex or ZSwarm production wiring. In the target dependency direction, the final `session-application` service is
the downward orchestration layer: it may depend on `session-topology`, `session-events`, and `session-protocol` to
execute one use case. None of those lower layers may call back into the application layer; topology and events may use
protocol storage/transaction capabilities without becoming application-aware.

The document is a decision surface, not an accepted runtime contract. It must label the proposal as a review draft,
distinguish current behavior from target behavior, and link to both the implementation-level refactor view and the
governed construction plan. Accepted decisions move into the specs that own the corresponding protocol, topology,
runtime, or adapter behavior.

Several decisions have since been accepted, and the view now carries them as settled rather than proposed. The driver
is the runtime's built-in synchronous SQLite binding, and the interpreter floor stays where the fleet already is; the
minimum SQLite version is derived from the SQL features the engine actually uses rather than reverse-engineered from a
defect, and the page must show that derivation with its sources, since the binding constraint is when the JSON
functions became built-ins rather than the more visible strict-table support. A version gate compares numerically,
because lexical comparison ranks a far older release above a newer one.

Write-ahead logging is outside this version. Its reset defect spans every release up to the one that fixed it, and the
condition that triggers it — several connections writing or checkpointing the same file at once — is this
architecture's normal shape rather than an edge case, so the rollback journal both avoids the defect and keeps the
existing interpreter floor. Enabling write-ahead logging is a separate future experiment gated on the fixed release,
and the page must not present it as available now.

Storage locality is an adopter precondition, not a protocol capability: the resolver establishes that a resolved
absolute database path is local and supports reliable advisory locking before the protocol is opened, and refuses when
locality is non-local or undetermined. The refusal is the default, recognition is the exception, and the protocol core
neither performs nor simulates the check. The page must state why explicitly, because the rollback journal removed the
refusal that write-ahead logging supplied for free by requiring shared memory, and nothing in this view may be read as
evidence that the journal choice makes network storage safe.

The address space inside one database is flat and global. Product scoping such as a project identifier is adopter
metadata that never enters a protocol address, and an adopter sharing one database across projects owns the
uniqueness of the identifiers it mints. Acceptance additionally requires that a run refuses an interpreter below the
floor, that a process never links two separate SQLite builds against one database, and that taking a message is
at-most-once with any handler journal owned by the consumer.
