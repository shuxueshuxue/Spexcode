---
title: adopter integration proof
status: active
hue: 280
desc: Installed-consumer proof for composing protocol, topology, and adopter-owned runtime bindings without a production importer.
code:
  - scripts/adopter-integration-yatu.mjs
related:
  - docs/session-adopter-integration-plan.md
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
  - .spec/spexcode/session-runtime/zswarm-cutover/zswarm-adopter/spec.md
  - .spec/spexcode/session-topology/spec.md
---
# adopter integration proof

This node owns the installed-consumer proof for the common adopter composition. It does not claim that Spex
governed or ZSwarm production code has imported the new runtime package.

## Contract

An adopter opens one explicit protocol database and composes three independent facets:

1. protocol owns session addresses and at-most-once message transfer;
2. topology owns neutral edges and recipient discovery;
3. runtime bindings own the mapping from a protocol address to an adopter-native runtime identity.

The adopter owns the application service that calls these facets. A topology mutation and every notification it
requires are committed by one `ProtocolTransaction`; a binding is resolved and validated before `dequeue`. The
protocol package does not read the topology or binding tables, and neither table adds columns to protocol rows.

The proof must run after packing and installing the three public packages into a repository-external temporary
consumer. Its dependency graph must contain the three packages and must not contain `@spexcode/session-core`,
`@spexcode/spec-cli`, or a Spex backend. The consumer must observe the committed edge, binding, and exact message,
then show that a stale binding generation is rejected and a second dequeue is empty.

## Deliberate boundary

The current Spex governed entrypoints and the ZSwarm cutover proposal are separate repositories/owners and are not
modified by this node. Their production cut-in is `NOT-MEASURED(production importer not present in this worktree;
ZSwarm merge requires external owner approval)`. A clean consumer result is sufficient for package composition, not
for claiming either adopter is landed.

## Failure signal

The proof must fail if a consumer publishes a topology edge in one commit and its notification in another, if a
binding is resolved after dequeue, or if an installed dependency pulls a forbidden Spex runtime package. These are
application-service defects; adding callbacks or adopter fields to the protocol is not an allowed repair.
