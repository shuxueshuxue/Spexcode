---
scenarios:
  - name: external-runtime-state-reaches-parent-through-one-file-protocol
    tags: [cli]
    description: >
      From a fresh installed protocol/runtime consumer and an isolated canonical store, initialize one external
      runtime root and one child in one process, publish a versioned message, and drain the root from a second
      process. Replay the exact idempotency key after a simulated retry.
    expected: >
      Root and child use protocol addresses; topology and runtime binding facts stay in their owning components.
      The second process receives exactly one opaque message through the root pending queue. Exact idempotency replay
      does not duplicate delivery, while changed bytes under the same key fail loudly. No runtime launch, stop,
      socket, or process-control effect occurs in the package.
---

# runtime-session loss

Exercise the installed public `@spexcode/session-protocol` entry and the separate runtime-binding package. Inspect
the isolated SQLite store narrowly for address/message facts, and use process boundaries for publication and drain
so an in-memory implementation cannot pass.
