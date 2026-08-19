---
title: session-management-refactor-review
status: active
hue: 195
desc: The human-reviewable implementation plan for moving session state from coordinated files to short SQLite transactions.
code:
  - docs/session-management-refactor.html
related:
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/concept-map/platform-architecture/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - packages/session-core/src/index.ts
  - spec-cli/src/sessions.ts
---
# session-management-refactor-review

This node owns the linked HTML review view for the proposed SQLite-backed session management refactor. The document
must make the physical database, minimal schema, transaction boundaries, cross-process delivery path, adopter
extension rules, legacy mapping, migration milestones, verification matrix, and operational constraints concrete
enough to review independently.

The document is not an implementation claim. Its schema and milestones remain a proposal until human review accepts
them and the owning protocol, topology, and runtime specs are updated before code migration begins.
