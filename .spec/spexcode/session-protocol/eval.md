---
scenarios:
  - name: installed-package-roundtrip
    tags: [cli]
    description: >
      Pack spec-core and session-core, install those tarballs in a fresh Git consumer outside the source
      repository, isolate SPEXCODE_HOME, and use only the public package entry to accept, drain, and read one
      message.
    expected: >
      The installed package resolves without source or TypeScript, the delivery callback receives the frozen
      transport text exactly once, and timelineTail returns the raw conversational text from the canonical
      SpexCode project store.
    code: packages/session-core/src/index.ts
    related: packages/session-core/package.json
  - name: keyed-accept-recovers-crash-boundaries
    tags: [cli]
    description: >
      Exercise a keyed acceptance whose queue file disappears after its timeline receipt, then exercise a
      settled receipt whose queue head remains after delivery.
    expected: >
      Retrying restores the exact frozen debt without recomposing; a settled leftover head is removed without
      a second insert; a settled replay creates no new debt.
    test:
      path: packages/session-core/src/session-protocol.test.ts
      name: a keyed retry restores debt lost after the receipt append, then settles exactly once
    code: packages/session-core/src/message.ts
    related: packages/session-core/src/delivery-queue.ts
---
# session-core loss

The package boundary is real only when an installed consumer can use the durable protocol and when the
receipt/queue crash boundaries remain one implementation rather than knowledge every runtime must reproduce.
