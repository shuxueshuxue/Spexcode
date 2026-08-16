---
scenarios:
  - name: internal-entry-composes-fenced-transaction
    tags: [cli]
    description: >
      Pack and install session-core in a fresh consumer, import `@spexcode/session-core/internal`, and use its
      record-lock and exact queue-snapshot primitives to compose one bounded transaction. Also inspect the root
      package entry from that consumer.
    expected: >
      The named internal entry resolves and the composed operation observes one coherent locked snapshot. The root
      entry exposes complete accept/drain operations but none of the half-write transaction primitives.
---

# internal-transactions loss

Measure from a fresh installed consumer. The boundary is the package export map and the behavior of the exported
transaction primitives, not a source-file import.
