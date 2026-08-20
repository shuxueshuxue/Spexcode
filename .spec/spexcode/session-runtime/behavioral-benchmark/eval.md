---
scenarios:
  - name: weak-instruction-single-session
    description: Run a real Terminal-Bench task with a short instruction and no forced decomposition.
    expected: The task verifier passes without inventing a worker tree.
    tags: [cli]
  - name: forced-swarm-write-collection
    description: Run a real write-oriented task with isolated workers that each commit an artifact.
    expected: The parent collects the commits, child states become merged only after patch-equivalent delivery, all protocol messages are dequeued, and the independent verifier passes.
    tags: [cli]
  - name: layered-session-delivery
    description: Run a parent, child, and grandchild Swarm tree through the real CLI and inspect SQLite afterward.
    expected: Parent-child edges, state notifications, and dequeue records agree across all layers.
    tags: [cli]
---

The readings for these scenarios are retained in the benchmark report until the forced write-collection run is
completed on a clean fixture and filed with its final code revision.
