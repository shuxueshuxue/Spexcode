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
  - .spec/spexcode/session-protocol/concept-map/construction-roadmap/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - packages/session-application/src/index.ts
  - spec-cli/src/sessions.ts
---
# session-management-refactor-review

This node owns the linked HTML review view for the proposed SQLite-backed session management refactor. The document
must make the physical database, minimal schema, transaction boundaries, cross-process delivery path, adopter
extension rules, legacy mapping, migration milestones, verification matrix, and operational constraints concrete
enough to review independently.

The document is not an implementation claim. Its schema and milestones remain a proposal until human review accepts
them and the owning protocol, topology, and runtime specs are updated before code migration begins. It must not
propose runtime compatibility as a migration strategy: every adopter cutover pairs a positive path with legacy
sabotage and deletion, while any required data conversion remains a bounded one-way operation outside normal runtime.

The connection bootstrap it shows is ordered, and the order is part of the contract rather than a matter of style. The
busy handler must be established by the first statement on a connection, because its default leaves every earlier
statement running with no handler at all — measured, that made the version probe the flakiest statement in the engine
and lost most contended cold opens. Journal mode is asserted and never set: this version fixes the rollback journal,
reads the mode back, and fails loudly on anything else rather than converting a write-ahead database, since a runtime
dual path is precisely what the refactor exists to delete. The page shows the resulting sidecar lifecycle, which has
no write-ahead or shared-memory files at all.

Its network-filesystem guidance is inverted from the original proposal. Write-ahead logging refused network storage
automatically by requiring shared memory between processes; the rollback journal does not, and advisory locking there
is unreliable, so the protection is now something the adopter's path resolver states explicitly and fails closed on.
Nothing in the view may read as though the journal choice made network storage safe.

Taking a message stays at-most-once, and the consumer's handler journal is neither part of the protocol nor bound to
the same transaction. The same-database seam is closed around a relation change and the sends that change requires;
it does not admit a dequeue. A consumer that keeps a journal owns its own crash and retry proof and may not present it
as a protocol-level at-least-once guarantee, and the page must name the resulting loss — a consumer dying between the
commit and its own journal write — as a chosen cost rather than an oversight.

This page's migration numbering is local to it and describes implementation order only. The construction plan's
milestones are the scheduling authority, and because the two were read as one scheme, the page must carry an explicit
crosswalk between them and defer to the construction plan wherever they disagree. That crosswalk also records the
ordering correction that the importer is built and proven before the cutover that removes the legacy readers it
depends on.
