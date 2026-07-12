---
scenarios:
  - name: dashboard-serves-bundled
    tags: [cli]
    description: >
      Against a built bundle, run `spex serve ui --port P --api-port 8787` and drive it as a browser would
      with curl: the dashboard index, a hashed bundled asset, an unknown SPA route, and an /api hit that must
      reach a running `spex serve`. Read the startup line and confirm the bind is loopback-only.
    expected: |
      Startup logs which dist it serves ("serving monorepo build" — the package ships spec-dashboard/dist
      in-layout, so the sibling-path resolver finds the SHIPPED bundle even in a clean npm install) and
      "[gateway] dashboard on http://localhost:P". GET / → 200 and is the BUNDLED index.html (contains
      <title>SpexCode</title> and a hashed /assets/index-*.js reference, not a vite dev shell). GET that
      asset → 200 text/javascript. An unknown non-file route (/some/deep/route) → 200 (SPA fallback to
      index.html). GET /api/graph is proxied to the backend — 200 application/json when `spex serve` is up,
      502 when it is not. The listener is on 127.0.0.1 only by default; with `--host 0.0.0.0` it binds
      wide, the startup line names the real bind and announces "OPEN (no password)".
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
  - name: dev-loop-launch-no-prefix-leak
    tags: [cli]
    description: >
      Start the dogfood backend the documented way — `npm run api` from the repo root — and read the
      environment of the spawned `serve` child. Confirms the launch does not hand the backend (and the agents
      it spawns) a hijacked npm global prefix.
    expected: |
      The serve child's environment carries NO `npm_config_prefix` pointing into the repo tree — it is unset,
      or the real global root (e.g. /opt/node22). A dispatched agent then inherits a clean prefix, so its own
      `npm i -g` self-update lands in the true global root, not `$repo/spec-cli/lib/node_modules`. A run that
      exports `npm_config_prefix=$repo/spec-cli` to the child is a failure — the `npm --prefix` footgun.
    code: package.json
    related: spec-cli/src/supervise.ts
---
# packaging loss

YATU through the real product surface: drive the actual `spex dashboard` listener over HTTP with curl, as an
installed user's browser would — never assert the serve from an internal helper. The dist under test is the
PREBUILT bundle (`dashboard-dist`, what the published package ships), not a vite dev server. The install
scenario is likewise measured from a clean npm consumer project, not by running source-tree helpers.
