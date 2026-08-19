---
title: session-architecture-concept-map
status: active
hue: 280
desc: The review ledger that inventories, justifies, and subtracts every candidate element around the session communication protocol and its adopters.
code:
  - docs/session-architecture-concept-map.md
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-protocol/concept-map/platform-architecture/spec.md
  - .spec/spexcode/session-protocol/concept-map/session-management-refactor/spec.md
  - .spec/spexcode/session-protocol/concept-map/construction-roadmap/spec.md
  - packages/spec-core/src/project-store.ts
  - packages/spec-core/src/layout.ts
  - packages/session-core/src/index.ts
  - packages/session-core/src/runtime-session.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
---
# session-architecture-concept-map

This node owns the review worksheet for expanding and then reducing the session communication architecture. It is
an official decision ledger, not a second runtime contract. The worksheet must enumerate every candidate durable
file, package, module, data type, operation, transaction rule, topology element, runtime adapter, materialization
adapter, and configuration boundary that the proposed architecture introduces or inherits.

Human review has frozen the v1 architecture decisions recorded below: one adopter-owned SQLite database per
application state instance, an explicit absolute `databasePath`, topology mutation plus required enqueue in one
bounded synchronous transaction on that same database, at-most-once dequeue at the protocol boundary, and
adopter cutovers that sabotage then physically delete legacy facilities. V1 has no outbox, keyed replay,
dispatcher, observer correctness, cross-database fallback, dual-read, dual-write, fallback, or permanent
compatibility adapter. Driver choice, exact DDL, SQLite minimum version/PRAGMAs, migration mechanics, and other
implementation details remain open until their owning implementation specs freeze them.

Every candidate has one independent usefulness argument and one explicit disposition: keep, move, remove, or
open. A remove decision names the retained mechanism that replaces it. An open decision states what evidence is
missing. The frozen v1 decisions are authoritative for this review ledger; implementation-specific open items
remain unresolved until they are written into their owning current-state specs.

The linked platform-architecture, session-management-refactor, and construction-roadmap child nodes are the review
views for the SQLite-backed target. They summarize the worksheet, implementation shape, and governed cutover plan;
they do not silently supersede the current runtime specs. Their implementation contracts must still be updated in
their owning nodes before production code migration.

The worksheet must pressure-test the same protocol through ZSwarm, ungoverned self-launch, and Spex-governed
adopters. Physical state placement stays outside the protocol language: the protocol receives an explicit absolute
database path, while each adopter owns global configuration, project namespacing, OS defaults, and migration from
legacy directories. Protocol identity lives in the adopter database, not in a universal `session.json` file.

Each adopter proof is a cutover proof, not merely a new integration. It must pair positive adoption with an exact
legacy inventory, sabotage tests that make every old path unavailable, and physical deletion of the old reader,
writer, lock, observer, generated file, configuration alias, and compatibility branch. Runtime dual-read,
dual-write, fallback, and permanent translation adapters are forbidden. Necessary user-data upgrades are explicit,
bounded, one-way migrations that leave the normal runtime unable to recognize the legacy format.
