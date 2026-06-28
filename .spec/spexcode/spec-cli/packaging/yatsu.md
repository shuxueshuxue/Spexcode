---
scenarios:
  - name: dashboard-serves-bundled
    description: >
      Against a built bundle, run `spex dashboard --port P --api-port 8787` and drive it as a browser would
      with curl: the dashboard index, a hashed bundled asset, an unknown SPA route, and an /api hit that must
      reach a running `spex serve`. Read the startup line and confirm the bind is loopback-only.
    expected: |
      Startup logs "serving bundled build" and "[gateway] dashboard on http://localhost:P". GET / → 200 and
      is the BUNDLED index.html (contains <title>SpexCode</title> and a hashed /assets/index-*.js reference,
      not a vite dev shell). GET that asset → 200 text/javascript. An unknown non-file route (/some/deep/route)
      → 200 (SPA fallback to index.html). GET /api/board is proxied to the backend on :8787 — 200
      application/json when `spex serve` is up, 502 when it is not. The listener is on 127.0.0.1 only.
    code: spec-cli/src/gateway.ts
    related: spec-cli/src/cli.ts
---
# packaging loss

YATU through the real product surface: drive the actual `spex dashboard` listener over HTTP with curl, as an
installed user's browser would — never assert the serve from an internal helper. The dist under test is the
PREBUILT bundle (`dashboard-dist`, what the published package ships), not a vite dev server.
