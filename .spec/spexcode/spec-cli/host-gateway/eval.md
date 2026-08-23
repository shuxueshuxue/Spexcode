---
scenarios:
  - name: unreadable-project-config-keeps-catalog
    tags: [backend-api, cli]
    test:
      path: spec-cli/src/host.test.ts
      name: GET /projects stays available when one cataloged config is unreadable
    description: >-
      Run the host gateway against an isolated catalog containing a healthy project and a project whose
      portable `spexcode.json` cannot be read. Request the real `/projects` endpoint through the hub.
    expected: >-
      The endpoint answers HTTP 200. The healthy project remains listed, while the unreadable project is
      retained as an offline row with default identity/config projection and one actionable warning; the
      unreadable project never turns the host catalog into an internal error.
  - name: host-reconcile-and-proxy
    tags: [backend-api, cli]
    test:
      path: spec-cli/src/host.test.ts
      name: full host gateway integration suite
    description: >-
      Run `tsx --test spec-cli/src/host.test.ts`: real HTTP/SSE/WS/TLS gateway sockets, instance-validated
      endpoint records, durable/offline catalog, a spawned real `spex serve` from a linked worktree,
      gateway/project structured icon writes, raw project config, host-directory browsing, explicit
      Git/SpexCode setup, registration and host operations.
    expected: >-
      A versioned record claims the actual served git toplevel and resolved identity; a linked worktree gets
      its own slot and cannot replace main. Instance/root mismatches, dead/recycled URLs, mis-slotted and old
      records never proxy, and a cataloged or record-claimed root whose directory no longer exists is absent
      from the reconciled list. Live identity changes and restarted generations refresh the catalog. Two project
      projections plus the gateway projection remain distinct. Gateway icon writes are admin-only and touch
      only `SPEXCODE_HOME/config.json`; project writes are admin-only, revision-checked, atomic, preserve
      other JSON fields, work offline, accept featured ids and well-formed Iconify names, and return canonical
      bytes/projection. Existing emoji/Iconify config remains resolved. The admin-only directory browser
      returns directory metadata without file contents. A plain folder enters only after explicit Git
      initialization; every selected root that is still unborn receives a bootstrap commit containing its
      existing files and any requested SpexCode setup, while a parent repository is never touched. Requested
      setup runs the real `spex init`, and a failed init returns its transcript without writing the catalog.
      `/projects`, stream, scoped HTTP/WS, TLS, registration, raw config, and
      shell routing retain their auth and transport contracts. If one cataloged project's portable config
      is unreadable, reconciliation logs an actionable warning, keeps that project as an offline/default
      row, and still returns the other projects with HTTP 200; the strict raw-config endpoint continues
      to report the underlying read error.
    related: [spec-cli/src/supervise.ts, spec-cli/src/gateway-hub.ts, spec-cli/src/host.test.ts]
---
# measuring host-gateway

YATU is the integration suite's real processes, files, and sockets under an isolated `SPEXCODE_HOME`; file
its transcript. Library-only resolver assertions are auxiliary.
