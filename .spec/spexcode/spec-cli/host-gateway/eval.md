---
scenarios:
  - name: host-reconcile-and-proxy
    tags: [backend-api, cli]
    description: >-
      Drive the host level through the real surfaces. (1) Records: start a real `spex serve --port P` in a
      throwaway git repo under an isolated SPEXCODE_HOME; watch for its backend.json (it must appear only
      after the bind succeeds), GET its /api/instance, then SIGTERM the serve and watch the record go. (2)
      Reconcile + the hub mount: lay down records for an identity-matched live backend, a live backend
      answering a DIFFERENT instanceId, a dead url, a record copied into a store slot its root does not
      own, a legacy {url,pid} record, and a catalog-only project; start `spex dashboard`'s gateway
      (startHostDashboard — the hub with the host extensions) on a free port and, as an implicit-loopback
      admin, GET /projects, the /projects/stream SSE, the browser-navigation loop (GET / with a browser
      Accept header, then the redirected GET /projects with the same text/html Accept, plus an explicit
      application/json fetch of the same path), /p/<projectId>/api/* (live, catalog-offline,
      unknown), a non-API /p/ path, a non-hub path (the shell), POST a git repo and a non-repo to
      /projects, POST an op on an unknown project, and open a raw WebSocket upgrade through
      /p/<projectId>/api/…. For a registered offline repo, GET its `/projects/:id/config`, PUT a valid
      top-level JSON object, read the resulting `spexcode.json` on disk, then attempt an invalid write
      and a write against a stale revision. (3) TLS pass-through: start the same gateway again with the hub's `tls`
      option (a throwaway self-signed cert) and drive GET /projects, /p/<projectId>/api/*, and a shell
      path over HTTPS on the one port, plus a plaintext probe of that TLS port.
      `tsx --test spec-cli/src/host.test.ts` drives exactly this loop end to end —
      file its transcript with
      `spex eval add host-gateway --scenario host-reconcile-and-proxy --result <txt> --pass`.
    expected: >-
      The record carries {url, pid, instanceId, root}, appears only after bind, matches the live
      /api/instance answer, and a clean stop removes only its own record (a newer generation's survives an
      older's drop). Reconcile lists ONLY the identity-matched backend online; the mismatched and dead
      records read offline, the mis-slotted and legacy records yield nothing, the catalog-only project
      lists offline. Through the hub-mounted gateway: GET /projects (implicit loopback admin) returns the
      reconciled rows each carrying the hub row key and gating flag; browser navigation lands on the
      Projects UI — GET / 302s to /projects and the redirected text/html GET serves the SPA shell on
      that one content-negotiated route, while application/json and default-Accept fetches of the same
      path keep the catalog envelope; the stream's first event is the
      current list; /p/<id>/api/* reaches the right backend with the /p prefix stripped and query intact;
      a project with no live record — unknown or catalog-offline alike — answers 404 before any upstream
      contact; a non-API /p path is proxied to the backend; a non-hub path serves the SPA shell; a git
      repo registers via POST /projects (a non-repo is a 400, an op on an unknown project a 404); its
      raw `spexcode.json` is readable and atomically writable even while offline, malformed JSON is
      refused, and a stale revision returns a conflict without losing the newer disk content; the WS
      upgrade raw-pipes the backend's 101 + bytes with the same prefix strip. With `tls` passed through,
      the SAME admin list, /p proxy, and shell answer over HTTPS on the one port and a plaintext client
      on that port is refused — never silently downgraded; without `tls` the gateway stays plain
      loopback HTTP.
    related: [spec-cli/src/supervise.ts, spec-cli/src/gateway-hub.ts, spec-cli/src/host.test.ts]
---
# measuring host-gateway

YATU: every reading goes through a REAL `spex serve` process and a REAL gateway socket — never through
the reconciler called as a library with hand-built state passed around the product surface. The
integration suite (`spec-cli/src/host.test.ts`) is the scripted form of that loop: real spawned serve,
real HTTP/SSE/WS through the hub-mounted gateway port, isolated per-run SPEXCODE_HOME. A by-hand pass is
the same shape: two `spex serve`s in two repos, one `spex dashboard`, and a browser/curl against
/projects and /p/<projectId>/api/graph. (The hub's own auth/isolation boundaries are [[gateway-hub]]'s
scenario, measured by its suite.)
