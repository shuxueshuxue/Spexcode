---
title: packaging
status: active
hue: 280
desc: SpexCode installs as one npm package (`npm i -g spexcode` → `spex`); the tarball is the monorepo's runtime subset with the layout preserved, and the natural post-install startup is two commands on two ports.
code:
  - package.json
  - scripts/prepack.mjs
  - spec-cli/package.json
  - spec-cli/bin/spex.mjs
  - spec-cli/src/tsx-bin.ts
related:
  - spec-cli/src/cli.ts
---
# packaging

SpexCode ships as a single installable npm package named `spexcode`. `npm i -g spexcode` puts **one**
command on PATH — `spex` — and nothing else the user must wire. The package carries everything the tool
needs on a machine that has never seen the source: the CLI, its `spex init` templates, the git/harness
hooks, and the **prebuilt** dashboard. There is no build step on the user's machine — the launcher runs
the TypeScript directly through tsx (a real dependency, not a dev-only tool), the dogfood's no-build stance.

The published unit is the **monorepo root**, shipping the runtime subset with the **layout preserved**: an
explicit `files` allowlist of `spec-cli/{src,bin,templates,hooks}`, the siblings `spec-yatsu/src` and
`spec-forge/src`, and `spec-dashboard/dist`. The dist is the one shipped artifact not in git, so it is built
by the **`prepack`** lifecycle hook — the point npm runs *whenever it builds a tarball*, on both `npm pack`
and `npm publish` (but never on a plain `npm install`). That makes tarball-completeness the contract of
*producing a tarball at all*, not a publish-only afterthought: pack and publish emit the identical complete
package, and `npm pack` self-corrects a stale or missing dist instead of silently shipping one. Preserving
the layout is the whole point: spec-cli, spec-yatsu, and spec-forge import each
other by filesystem-relative `../../spec-*` paths (a cycle), so shipping them flat under one package —
`spexcode/spec-cli/…`, `spexcode/spec-yatsu/…` — makes every such import resolve **in-package, zero import
rewriting**. The bin and all entry source stay under `spec-cli/src`, so each module's `pkgRoot` still lands
at `spec-cli/` and its asset lookups (templates, hooks, dist) are unchanged. The one thing that moves is
tsx: spec-cli is now a subdir, so the dep installs at the *package root's* `node_modules` — `tsxBin`
resolves it against both spots (dev `spec-cli/node_modules`, published the package root), and the same is
true for the supervisor's child spawn and the baked launch/hook commands. The repo-root `README.md` ships
too, so the npm page reads the same as GitHub. The internal `spec-cli` package stays private — the one
public name belongs to the tool a user installs.

The natural way to run the installed tool is **two commands on two ports, deliberately kept apart** —
starting the backend never drags the UI along:

- `spex serve` — the backend (API + sessions). `--port N` sets its listen port (sugar over the `PORT` env).
- `spex dashboard` — the UI on its own port, serving the bundled dist and proxying `/api` + the terminal
  socket to a running `spex serve` (`--api-port N` names that backend). The post-install replacement for the
  dogfood-only `npm run web` (a vite dev server against a source tree an installed user has no copy of).

Both ports are **explicit flags**, which is what lets several projects coexist on one host:
`spex serve --port 8788` beside `spex dashboard --port 5174 --api-port 8788` runs a second instance next
to the dogfood's 8787/5173, with cwd choosing which project's `.spec` each serves — no shared default
silently collides two projects.

`spex dashboard` shares the serve-the-built-dashboard engine with [[public-mode]] — local serve is that
same gateway on loopback with no TLS and no password. The dogfood monorepo is unaffected: its root keeps
the `npm run api`/`npm run web` dev loop, and the dist resolver falls back to the sibling
`spec-dashboard/dist` whenever no bundled copy is present.
