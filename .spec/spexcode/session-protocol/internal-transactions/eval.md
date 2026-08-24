---
scenarios:
  - name: internal-entry-composes-fenced-transaction
    tags: [cli]
    description: >
      Pack and install `@spexcode/session-protocol` in a fresh consumer and compose one bounded transaction through
      the public transaction callback without importing an internal entry. Also inspect the package export map.
    expected: >
      The protocol entry resolves, no `session-core` or `/internal` path exists, and the composed operation observes
      one coherent transaction while exposing no half-write compatibility primitive.
---

# internal-transactions loss

Measure from a fresh installed consumer. The boundary is the package export map and the behavior of the exported
transaction primitives, not a source-file import.
