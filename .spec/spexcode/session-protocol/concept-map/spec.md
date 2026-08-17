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

Every candidate has one independent usefulness argument and one explicit disposition: keep, move, remove, or
open. A remove decision names the retained mechanism that replaces it. An open decision states what evidence is
missing. Human review may accept or replace each disposition; accepted decisions are then written into their
owning current-state specs and removed from the unresolved list.

The worksheet must pressure-test the same protocol through Z-Storm, ungoverned self-launch, and Spex-governed
adopters. It must also keep physical state placement outside the protocol language: the protocol owns a fixed
relative filesystem layout below an injected absolute session root, while each adopter owns global configuration,
project namespacing, OS defaults, and migration from legacy directories.

Every initialized session has one universal immutable `session.json` identity record. The current SpexCode
monolith with the same filename is migration input, not the target schema: governed lifecycle, topology, worktree,
and runtime facts leave that file for their owning adopter modules.
