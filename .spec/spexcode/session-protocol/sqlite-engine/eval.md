---
scenarios:
  - name: engine-contract-vectors-hold-on-the-reference-driver
    tags: [cli]
    description: >
      Run the contract's conformance vectors against the reference engine, including the ones that need real
      operating-system processes: eight processes cold-opening one fresh database, concurrent consumers racing a
      single queue, and a cursor advanced while other processes commit.
    expected: >
      Every vector passes. The database migrates exactly once under a cold-open race, exactly one consumer receives
      each message, a cursor observes every committed message exactly once and skips none, and a short write stays
      bounded well past 500 writes in ten seconds with a bounded tail.
    code: docs/session-protocol-sqlite-engine.md
    related: spikes/sqlite-m2/test/concurrency.test.mjs
  - name: frozen-decisions-each-have-a-firing-counterexample
    tags: [cli]
    description: >
      Regenerate one deliberately wrong implementation per frozen decision, each a minimal edit from the reference
      engine, and drive the identical vectors through every one of them.
    expected: >
      Each flip is caught by at least one vector, and every reported failure is one of the contract's own assertions
      naming the violated claim. A stub that fails to load is reported as a harness failure and never counted as a
      counter-example, so a decision that was not actually measured cannot appear as one that was.
    code: docs/session-protocol-sqlite-engine.md
    related: spikes/sqlite-m2/stubs/build.mjs
  - name: contract-is-driver-independent
    tags: [cli]
    description: >
      Drive the identical single-process vectors through the second candidate SQLite binding, changing nothing but
      the binding, then check what the two bindings do to each other's locks in one process and across two.
    expected: >
      Both bindings pass the same vectors with no change to the schema, the canonical encoding, or the error codes,
      which is what makes the binding a replaceable implementation rather than part of the contract. Two bindings in
      one process do not observe each other's write lock, so a binding is a process-global commitment; across
      processes they serialise correctly.
    code: docs/session-protocol-sqlite-engine.md
    related: spikes/sqlite-m2/drivers/better-sqlite3.mjs
---
# sqlite-engine loss

The loss signal for a contract is whether its claims still measure true, so these scenarios run the contract's
executable form rather than reading the document. The measured surface is the M2 spike, which is what exists at this
milestone by design: there is deliberately no product wiring, no adopter, and no published package yet, so a reading
here proves the contract holds, not that any product ships it.

Two properties matter more than the pass count. Every frozen decision must have a counter-example that actually
fires, because a vector suite that passes against a wrong implementation pins nothing. And a measurement that did not
run must never be reportable as a measurement that found nothing.

When the protocol implementation replaces the spike, these scenarios move to it unchanged; the schema, the canonical
encoding, the error codes, and the version gate are the portable assets and do not change with the surface.
