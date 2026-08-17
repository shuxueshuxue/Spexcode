---
scenarios:
  - name: external-runtime-state-reaches-parent-through-one-file-protocol
    tags: [cli]
    description: >
      From a fresh installed session-core consumer and an isolated canonical store, register one external runtime
      root and one child in one process, publish a readiness-backed child state, and drain the root from a second
      process. Remove the root queue after another revision's receipt append and replay that exact revision.
    expected: >
      Root and child use canonical non-governed session records and the child carries the canonical parent watch.
      The second process receives exactly one ordinary state message through the root pending queue. Exact revision
      replay restores crash-lost debt without duplicating a settled delivery, while changed state under the same
      revision fails loudly. No runtime launch, stop, socket, or process-control effect occurs in the package.
---

# runtime-session loss

Exercise only the installed public `@spexcode/session-core` entry. Inspect the isolated store narrowly for the
record/watch/queue facts, and use process boundaries for publication and drain so an in-memory implementation
cannot pass.
