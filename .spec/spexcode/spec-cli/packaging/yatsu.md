---
scenarios:
  - name: dashboard-serves-bundled
    tags: [cli]
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
  - name: clean-install-cli-starts
    tags: [cli]
    description: >
      Build the npm tarball with `npm pack`, install that tarball into a clean consumer project, then use the
      installed package the way a new user would: run `npx spex --help`, create a fresh git repo, and run the
      installed `spex init` inside it.
    expected: |
      The tarball builds the bundled dashboard during prepack and installs into the clean consumer project.
      `npx spex --help` starts the CLI without looking for a missing nested `spec-cli/node_modules/.bin/tsx`.
      Inside a fresh git repo, `spex init` exits 0 and plants `.spec/project/spec.md` plus `spexcode.json`.
    code:
      - package.json
      - spec-cli/bin/spex.mjs
      - spec-cli/src/tsx-bin.ts
    related:
      - spec-cli/src/init.ts
      - scripts/prepack.mjs
---
# packaging loss

YATU through the real product surface: drive the actual `spex dashboard` listener over HTTP with curl, as an
installed user's browser would — never assert the serve from an internal helper. The dist under test is the
PREBUILT bundle (`dashboard-dist`, what the published package ships), not a vite dev server. The install
scenario is likewise measured from a clean npm consumer project, not by running source-tree helpers.
