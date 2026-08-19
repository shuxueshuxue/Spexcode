---
title: session-platform-architecture-review
status: active
hue: 165
desc: The human-reviewable top-level view of the proposed SQLite-backed session platform and its three adopters.
code:
  - docs/session-platform-architecture.html
related:
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/concept-map/session-management-refactor/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
---
# session-platform-architecture-review

This node owns the linked HTML review view that presents the proposed session platform as one self-contained
architecture: a fixed communication protocol, adopter-owned topology and runtime composition, separate harness
runtime and configuration adapters, explicit storage placement, and the Z-Storm, self-launch, and Spex-governed
adoption paths.

The document is a decision surface, not an accepted runtime contract. It must label the proposal as a review draft,
distinguish current behavior from target behavior, and link to the implementation-level refactor view. Accepted
decisions move into the specs that own the corresponding protocol, topology, runtime, or adapter behavior.
