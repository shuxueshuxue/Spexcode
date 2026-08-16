---
scenarios:
  - name: keyed-acceptance-is-one-durable-operation
    tags: [cli]
    description: >
      From a fresh installed session-core consumer, accept a keyed message through the public package entry, remove
      its published queue file to simulate the receipt-to-queue crash boundary, and retry the same request. Then
      retry the key with a different payload.
    expected: >
      The same-key retry restores the exact frozen transport debt without recomposing or appending another public
      sent event. Reusing the key for different bytes fails loudly with MessageKeyConflict.
---

# message-accept loss

Use only the installed public package entry and the canonical isolated store. A helper or source import does not
exercise the runtime boundary this node owns.
