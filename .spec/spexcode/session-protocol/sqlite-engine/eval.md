---
scenarios:
  - name: engine-contract-vectors-hold-on-the-reference-driver
    tags: [cli]
    description: >
      Run the contract's conformance vectors against the reference engine in the journal mode v1 actually uses,
      including the ones that need real operating-system processes: eight processes cold-opening one fresh
      database, concurrent consumers racing a single queue, a cursor advanced while other processes commit, and a
      writer killed immediately before and immediately after its commit.
    expected: >
      Every vector passes. The database migrates exactly once under a cold-open race, exactly one consumer receives
      each message, a cursor observes every committed message exactly once and skips none, a kill before commit
      leaves nothing visible while a kill after commit never requeues, and a short write stays past 500 writes in
      ten seconds with a bounded tail under the journal mode shipped rather than a faster one measured earlier.
    code: docs/session-protocol-sqlite-engine.md
    related: spikes/sqlite-m2/test/concurrency.test.mjs
  - name: the-contract-runs-on-the-interpreter-the-fleet-pins
    tags: [cli]
    description: >
      Run the same vectors on the oldest interpreter the fleet actually deploys, whose bundled database engine is
      older than the one the development host provides.
    expected: >
      Every vector passes there too, and the engine's version gate admits that bundled version. A floor derived
      from the features the schema uses is only honest if the deployed interpreter clears it in practice.
    code: docs/session-protocol-sqlite-engine.md
    related: spikes/sqlite-m2/engine.mjs
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
      which is what keeps the binding a replaceable implementation even though v1 fixes which one ships. Two
      bindings in one process do not observe each other's write lock, so a binding is a process-global commitment;
      across processes they serialise correctly.
    code: docs/session-protocol-sqlite-engine.md
    related: spikes/sqlite-m2/drivers/better-sqlite3.mjs
---
# sqlite-engine loss

The loss signal for a contract is whether its claims still measure true, so these scenarios run the contract's
executable form rather than reading the document. The measured surface is the M2 spike, which is what exists at this
milestone by design: there is deliberately no product wiring, no adopter, and no published package yet, so a reading
here proves the contract holds, not that any product ships it.

A reading is bound to the design it was taken under. When a ruling replaced write-ahead logging with a rollback
journal, every concurrency, throughput, and crash figure measured under the old mode stopped representing this
contract, and the readings were retaken rather than left standing. A stale reading that still looks current is worse
than an unmeasured scenario, because it reports confidence nobody earned.

Two properties matter more than the pass count. Every frozen decision must have a counter-example that actually
fires, because a vector suite that passes against a wrong implementation pins nothing. And a measurement that did not
run must never be reportable as a measurement that found nothing.

When the protocol implementation replaces the spike, these scenarios move to it unchanged; the schema, the canonical
encoding, the error codes, and the version gate are the portable assets and do not change with the surface.
