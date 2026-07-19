---
scenarios:
  - name: host-reconcile-and-proxy
    tags: [backend-api, cli]
    test:
      path: spec-cli/src/host.test.ts
      name: full host gateway integration suite
    description: >-
      Run `tsx --test spec-cli/src/host.test.ts`: real HTTP/SSE/WS/TLS gateway sockets, instance-validated
      endpoint records, durable/offline catalog, a spawned real `spex serve` from a linked worktree,
      gateway/project structured icon writes, raw project config, registration and host operations.
    expected: >-
      A versioned record claims the actual served git toplevel and resolved identity; a linked worktree gets
      its own slot and cannot replace main. Instance/root mismatches, dead/recycled URLs, mis-slotted and old
      records never proxy. Live identity changes and restarted generations refresh the catalog. Two project
      projections plus the gateway projection remain distinct. Gateway icon writes are admin-only and touch
      only `SPEXCODE_HOME/config.json`; project writes are admin-only, revision-checked, atomic, preserve
      other JSON fields, work offline, and return canonical bytes/projection. Existing emoji/Iconify config
      remains resolved. `/projects`, stream, scoped HTTP/WS, TLS, registration, raw config, and shell routing
      retain their auth and transport contracts.
    related: [spec-cli/src/supervise.ts, spec-cli/src/gateway-hub.ts, spec-cli/src/host.test.ts]
---
# measuring host-gateway

YATU is the integration suite's real processes, files, and sockets under an isolated `SPEXCODE_HOME`; file
its transcript. Library-only resolver assertions are auxiliary.
