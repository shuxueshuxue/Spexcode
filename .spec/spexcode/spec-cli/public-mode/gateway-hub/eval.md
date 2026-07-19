---
scenarios:
  - name: multi-project-isolation
    tags: [backend-api]
    code: spec-cli/src/gateway-hub.ts
    test:
      path: spec-cli/src/gateway-hub.test.ts
      name: full lifecycle story (all tests in the file)
    description: >
      Run a real hub over HTTP fronting two loopback echo backends (plus a hostile non-loopback record) and
      walk the operator lifecycle as a visitor: open passthrough, the no-admin-password bootstrap (implicit
      loopback vs. a genuinely non-loopback connection with spoofed forwarding headers), setting the admin
      and project passwords through the gateway APIs, both designed login flows, cross-project and
      cross-scope access attempts, password rotation and clearing, hostile projectIds sent path-as-is, and
      a WebSocket upgrade with and without a session.
    expected: |
      An ungated project proxies straight through, prefix stripped, query preserved, spex_* cookies removed
      while foreign cookies pass. /projects answers a loopback caller with the registry (non-loopback
      records excluded) but 403s a non-loopback caller regardless of X-Forwarded-For; after
      PUT /projects/admin-password the caller holds an HttpOnly session and implicit loopback is over.
      Wrong passwords re-render the designed page 401; right ones 302 with an HttpOnly cookie. A project
      session reaches exactly its own /p/:id (API paths 401 as JSON, page paths redirect to that project's
      login), never the sibling project or /projects — including with the token relabeled under the other
      project's cookie name — while an admin session reaches both. A tampered token denies. Re-setting a
      project password kills its old sessions; DELETE reopens the project. Unknown, traversal-shaped, and
      non-loopback-upstream ids 404 with no upstream contact. A gated upgrade with no session is destroyed
      before any backend contact; with one it completes 101 and the backend sees only non-gateway cookies.
---

Measured through the product surface itself — the hub's public HTTP/WS face on a real port — via
`npx tsx --test spec-cli/src/gateway-hub.test.ts`; file the transcript. (The non-loopback cases need a
machine with any non-internal IPv4; the test skips them loudly otherwise.)
