# Adopter integration plan

## What this lane proves

The common downstream shape is now testable without pretending that either production adopter has been cut over:

```text
adopter application service
  |-- session-protocol       address, enqueue/dequeue, one transaction boundary
  |-- session-topology       neutral parent/recipient edges
  `-- session-runtime        adopter-owned native identity + generation fence
```

`protocol` remains closed. `topology` does not publish by itself, and `runtime` does not launch or inspect a
harness. The adopter application service is the owner of the orchestration: it mutates an edge and enqueues any
required notification in one `withTransaction` callback, then resolves a binding before handing a dequeued message
to a native adapter.

The executable proof is `scripts/adopter-integration-yatu.mjs`. It packs and installs the three packages into a
temporary consumer, checks the installed dependency graph, creates a parent/child relation, binds the child to an
opaque native identity, publishes one exact notification in the same transaction as the edge, and drains it once.
It also exercises a stale generation refusal and confirms a second drain is empty.

## Production boundary

This worktree has no production importer for the new runtime package. The Spex governed path still lives in
`spec-cli/src/sessions.ts` and its hook/dashboard callers; the ZSwarm implementation is the external proposal under
`/home/jeffry/zcode-m5` on `m5/zswarm-protocol-cutover`. Neither is modified here. The external proposal's merge is
owner-controlled because its repository has a design-change approval rule. Those two cut-ins are therefore recorded
as `NOT-MEASURED`, not as a green result inferred from the clean consumer.

## Next executable moves

1. Have the application-service lane expose the same transaction shape without importing protocol internals.
2. Have the Spex adopter owner supply a real native harness identity and run this proof through the governed entry.
3. After z-code owner approval, replace its bridge at the proposal's real lineage and rerun the same installed proof
   against the production command surface.

The package proof is a prerequisite for those moves, not a substitute for them.
