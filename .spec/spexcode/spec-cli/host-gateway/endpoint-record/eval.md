---
scenarios:
  - name: serve-publishes-a-validated-record-and-retires-only-its-own
    tags: [backend-api, cli]
    code: spec-cli/src/endpoint-record.ts
    related:
      - spec-cli/src/supervise.ts
      - spec-cli/src/host.ts
    description: >-
      Start a real `spex serve` on a free port under a disposable SPEXCODE_HOME, then read the published
      record at ~/.spexcode/projects/<encoded-root>/backend.json through the filesystem the host readers
      use. Check the record's shape and that its url answers /health. Overwrite the slot with a second
      record carrying a different instanceId, ask the retiring instance to drop its own, and read the slot
      again. Then stop the serve.
    expected: >-
      The published record is version 2 and carries url, pid, instanceId, root and a resolved identity;
      its url answers /health with ok. A retirement that names a different instanceId leaves the slot
      untouched, because the record is removed only by the writer that still owns it. Reading the record
      never requires the gateway: the module that answers these reads imports the layout helpers and the
      identity type and nothing that serves, routes or proxies.
---

Measured through a real `spex serve` and the on-disk record, never through the host reconciler — the point
of the node is that a backend publishes and a reader reads without either depending on the gateway.
