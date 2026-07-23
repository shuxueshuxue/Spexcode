---
title: packaging
status: active
hue: 280
desc: SpexCode installs as one npm package (`npm i -g spexcode` → `spex`); the tarball is the monorepo's runtime subset with the layout preserved, and the natural post-install startup is two commands on two ports.
code:
  - scripts/prepack.mjs
related:
  - spec-cli/src/cli.ts
  - package.json
  - package-lock.json
  - spec-cli/package.json
  - spec-cli/package-lock.json
  - spec-cli/bin/spex.mjs
  - spec-cli/src/tsx-bin.ts
  - spec-cli/src/launcher-tsx.test.ts
  - spec-cli/src/node-pty-package.test.ts
---
# packaging

SpexCode ships as a single installable npm package named `spexcode`. `npm i -g spexcode` puts **one**
command on PATH — `spex` — and nothing else the user must wire. The package carries everything the tool
needs on a machine that has never seen the source: the CLI, its `spex init` templates, the git/harness
hooks, and the **prebuilt** dashboard. There is no build step on the user's machine — the launcher runs
the TypeScript directly through tsx (a real dependency, not a dev-only tool), the dogfood's no-build stance.

The published unit is the **monorepo root**, shipping the runtime subset with the **layout preserved**: an
explicit `files` allowlist of `spec-cli/{src,bin,templates,hooks}`, the siblings `spec-eval/src` and
`spec-forge/src`, and `spec-dashboard/dist`. The dist is the one shipped artifact not in git, so it is built
by the **`prepack`** lifecycle hook — the point npm runs *whenever it builds a tarball*, on both `npm pack`
and `npm publish` (but never on a plain `npm install`). That makes tarball-completeness the contract of
*producing a tarball at all*, not a publish-only afterthought: pack and publish emit the identical complete
package, and `npm pack` self-corrects a stale or missing dist instead of silently shipping one. Preserving
the layout is the whole point: spec-cli, spec-eval, and spec-forge import each
other by filesystem-relative `../../spec-*` paths (a cycle), so shipping them flat under one package —
`spexcode/spec-cli/…`, `spexcode/spec-eval/…` — makes every such import resolve **in-package, zero import
rewriting**. The bin and all entry source stay under `spec-cli/src`, so each module's `pkgRoot` still lands
at `spec-cli/` and its asset lookups (templates, hooks, dist) are unchanged. The one thing that moves is
tsx: spec-cli is now a subdir, and a real npm install may hoist the dependency outside the `spexcode`
package into the consuming project's `node_modules`. So the launcher and every baked `tsx + cli.ts`
callback resolve it by one shared rule: use Node's own package resolver from `spec-cli` to find tsx's JS
entry (`tsx/dist/cli.mjs`), then run it through the current Node binary (`process.execPath`). That covers the
dev monorepo, a global install, and a project-local install without hardcoded consumer paths — and stays
cross-platform ([[platform-support]]): it never spawns the `.bin/tsx` shim (an extensionless sh script
`child_process.spawn` cannot execute on Windows) nor a `.mjs` by its shebang, the crash that broke
`spex init` on native Windows. The repo-root
`README.md` ships too, so the npm page reads the same as GitHub. The internal `spec-cli` package stays
private — the one public name belongs to the tool a user installs.

The installed terminal follows the same artifact rule. `node-pty` is pinned to an upstream release whose
Darwin prebuilds publish `spawn-helper` as an executable; SpexCode does not repair dependency permissions at
runtime or ask the user to mutate `node_modules`. This remains an npm-package boundary independent of global
versus project-local placement and independent of the host that receives the package. A narrow dependency
artifact test verifies both shipped Darwin helpers retain an execute bit. A package that exposes `spex` but
leaves the terminal's native helper unspawnable is not a complete installation.

The natural way to run the installed tool is **two commands on two ports, deliberately kept apart** —
starting the backend never drags the UI along:

- `spex serve` — the backend (API + sessions). `--port N` sets its listen port (sugar over the `PORT` env).
- `spex serve ui` — the UI on its own port, serving the bundled dist and proxying `/api` + the terminal
  socket to a running `spex serve` (`--api-port N` names that backend). The post-install replacement for the
  dogfood-only `npm run web` (a vite dev server against a source tree an installed user has no copy of).
  Loopback by default; `--host H` widens the bind for private-network viewing (a LAN or tailnet), still
  plain HTTP with no gate — the trust call is the network's, and a non-loopback bind is announced at
  startup, never silent. The internet face stays `spex serve --public`.

Both ports are **explicit flags**, which is what lets several projects coexist on one host:
`spex serve --port 8788` beside `spex serve ui --port 5174 --api-port 8788` runs a second instance next
to the dogfood's 8787/5173, with cwd choosing which project's `.spec` each serves — no shared default
silently collides two projects. (The pairing is the *explicit* multi-project story; the zero-pairing one —
one `spex dashboard` reaching every backend the user runs — is [[host-gateway]]'s contract.)

`spex serve ui` shares the serve-the-built-dashboard engine with [[public-mode]] — local serve is that
same gateway with no TLS and no password, on loopback unless `--host` widens it. The dogfood monorepo is unaffected: its root keeps
the `npm run api`/`npm run web` dev loop, and the dist resolver falls back to the sibling
`spec-dashboard/dist` whenever no bundled copy is present. Those root scripts delegate into a sibling
package with `cd spec-cli && npm run …`, never `npm --prefix spec-cli run …`: npm's `--prefix` is
overloaded — it also sets the **global install prefix**, which npm exports as `npm_config_prefix` to the
backend and every agent it launches, silently redirecting those agents' own `npm i -g` self-updates into the
repo tree instead of the real global root.

The packaging contract is verified as the user would meet it, not by inspecting files: CI builds the tarball,
installs that tarball into a clean consumer project, runs `npx spex --help`, then runs `spex init` inside a
fresh git repo and checks that the seed `.spec` tree and `spexcode.json` landed. A tarball that contains the
right files but cannot start from an npm install is a packaging failure.
