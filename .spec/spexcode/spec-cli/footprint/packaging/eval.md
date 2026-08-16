---
scenarios:
  - name: shipped-tarball-carries-what-the-verbs-need
    tags: [cli]
    description: >
      Build the root and dashboard tarballs, install only the root into a scratch prefix, then install the
      dashboard tarball explicitly. From that prefix alone drive `spex flat site`, which copies the graph-only
      dashboard shell beside a flat's payload. Nothing in the run may read the source checkout. Compare the
      shell the command emitted against the one inside the installed dashboard package.
    expected: >
      The verb exits 0 and the artifact it copied is byte-identical to the copy inside the installed dashboard
      package - proving it came from a package tarball, not from a checkout that happened to be nearby. A verb
      that works only where the repository is present is broken for every user, and it fails in the one direction
      a source checkout can never reveal.
    related: [scripts/prepack.mjs, package.json, spec-cli/src/flat.ts]
  - name: dashboard-serves-owned-package
    tags: [cli]
    description: >
      After explicitly installing the dashboard package beside a clean root install, run `spex serve ui --port P
      --api-port 8787` and drive it as a browser would with curl: the dashboard index, a hashed bundled asset,
      an unknown SPA route, and an /api hit that must reach a running `spex serve`. Read the startup line and
      confirm the bind is loopback-only.
    expected: |
      Startup logs the resolved `@spexcode/spec-dashboard` dist and "[gateway] dashboard on
      http://localhost:P". GET / -> 200 and is the bundled index.html (contains
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
      installed `spex init --harness codex` inside it.
    expected: |
      The root tarball installs into the clean consumer project without dashboard, TypeScript, tsx, or esbuild.
      `npx spex --help` starts the compiled CLI through Node.
      Inside a fresh git repo, `spex init --harness codex` exits 0 and plants `.spec/project/spec.md` plus
      `spexcode.json`; the config records Codex as the selected delivery target. Bare init remains a loud
      refusal because first adoption has no implicit harness choice.
      The consumer's production `node_modules` does not contain TypeScript; host projects carry the compiler
      only when their own development or JS-anchor setup needs it.
    code:
      - package.json
      - spec-cli/bin/spex.mjs
    related:
      - spec-cli/src/init.ts
      - scripts/prepack.mjs
  - name: cli-package-install-resolves-core
    tags: [cli]
    description: >
      From a clean checkout, run the CI installation order: `npm ci` at the root, then
      `cd spec-cli && npm ci`, then `npm run -s lint`.
    expected: >
      The package-local install preserves a resolvable `@spexcode/spec-core` link for CLI source imports,
      and `npm run -s lint` completes with zero errors. Replacing the root installation must not make the
      CLI depend on a workspace-hoisted core package that its own manifest failed to declare.
    code:
      - spec-cli/package.json
      - spec-cli/package-lock.json
    related:
      - spec-cli/src/lint.ts
      - .github/workflows/ci.yml
  - name: omit-optional-l0-adopter
    tags: [cli]
    description: >
      From a clean root-tarball install, drive every L0 verb through the shipped launcher. Run `spec lint`, `graph`,
      `materialize`, `init --harness claude` in a fresh Git directory, and `guide`. In the same dependency
      set, drive `serve ui` and `dashboard` without the dashboard package. Finally, drive the read-only L0
      verbs from a real non-TypeScript adopter whose tracked config governs `.` with `sourceExtensions: [py]`;
      run `materialize` only in a disposable clone of that adopter and compare the live project's Git state
      before and after.
    expected: >
      Every L0 verb exits 0: lint reports zero errors, graph renders a nonempty tree, materialize completes,
      init seeds `.spec/project/spec.md` and `spexcode.json`, and guide prints the workflow. `serve ui` and
      `dashboard` each exit 1 before binding a port, with no stack trace and the dashboard installation command.
      The Python adopter's real `.`/`py` configuration is
      honored by its lint and graph reads, its live worktree remains byte-for-byte Git-clean, and materialize
      succeeds in the isolated clone.
    code:
      - package.json
      - spec-cli/package.json
      - spec-cli/bin/spex.mjs
      - spec-cli/src/cli.ts
    related:
      - spec-cli/src/init.ts
      - spec-cli/src/materialize.ts
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
prebuilt bundle in `@spexcode/spec-dashboard`, not a vite dev server. The install scenario is likewise
measured from a clean npm consumer project, not by running source-tree helpers.
