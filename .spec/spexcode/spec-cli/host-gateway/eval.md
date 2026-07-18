---
scenarios:
  - name: host-reconcile-and-proxy
    tags: [backend-api, cli]
    description: >-
      Drive the host level through the real surfaces. (1) Records: start a real `spex serve --port P` in a
      throwaway git repo under an isolated SPEXCODE_HOME; watch for its backend.json (it must appear only
      after the bind succeeds), GET its /api/instance, then SIGTERM the serve and watch the record go. (2)
      Reconcile: lay down records for an identity-matched live backend, a live backend answering a DIFFERENT
      instanceId, a dead url, a record copied into a store slot its root does not own, a legacy {url,pid}
      record, and a catalog-only project; start the host gateway on a free port and GET /api/host/projects,
      the /stream SSE, /p/<projectId>/api/* (live, offline, unknown), a non-API /p/ path, POST a git repo and
      a non-repo to /api/host/projects, and open a raw WebSocket upgrade through /p/<projectId>/api/….
      `tsx --test spec-cli/src/host.test.ts` drives exactly this loop end to end — file its transcript with
      `spex eval add host-gateway --scenario host-reconcile-and-proxy --result <txt> --pass`.
    expected: >-
      The record carries {url, pid, instanceId, root}, appears only after bind, matches the live
      /api/instance answer, and a clean stop removes only its own record (a newer generation's survives an
      older's drop). Reconcile lists ONLY the identity-matched backend online; the mismatched and dead
      records read offline, the mis-slotted and legacy records yield nothing, the catalog-only project lists
      offline. Through the gateway: /p/<id>/api/* reaches the right backend with the /p prefix stripped and
      query intact; an offline project answers 502 naming the repair; an unknown one 404s; non-API paths
      serve the SPA shell; the stream's first event is the current list; a git repo registers (a non-repo is
      a 400); the WS upgrade raw-pipes the backend's 101 + bytes with the same prefix strip.
    related: [spec-cli/src/supervise.ts, spec-cli/src/host.test.ts]
---
# measuring host-gateway

YATU: every reading goes through a REAL `spex serve` process and a REAL host gateway socket — never
through the reconciler called as a library with hand-built state passed around the product surface.
The integration suite (`spec-cli/src/host.test.ts`) is the scripted form of that loop: real spawned
serve, real HTTP/SSE/WS through the gateway port, isolated per-run SPEXCODE_HOME. A by-hand pass is the
same shape: two `spex serve`s in two repos, one `spex dashboard`, and a browser/curl against
/api/host/projects and /p/<projectId>/api/graph.
