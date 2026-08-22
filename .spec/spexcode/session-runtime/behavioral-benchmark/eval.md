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
  - name: slopcodebench-file-backup
    description: Evolve the official SlopCodeBench file_backup problem through all four checkpoints in one real ZCode session, evaluating each frozen snapshot in the official Docker runner.
    expected: Every checkpoint remains independently runnable from its delivered snapshot, including declared dependencies, and all current plus regression tests pass.
    tags: [cli]
  - name: slopcodebench-code-search
    description: Evolve the official SlopCodeBench code_search problem through all five checkpoints in one real ZCode session, evaluating each frozen snapshot in the official Docker runner.
    expected: Every checkpoint is implemented and verified; a provider token-limit termination must fail loudly rather than return an empty successful turn.
    tags: [cli]
---

The readings for these scenarios are retained in the benchmark report until the forced write-collection run is
completed on a clean fixture and filed with its final code revision.
