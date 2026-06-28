---
title: packaging
status: active
hue: 280
desc: SpexCode installs as one npm package (`npm i -g spexcode` → `spex`); CLI source, templates, and the prebuilt dashboard ride inside it, and the natural post-install startup is two commands on two ports.
code:
  - spec-cli/package.json
  - spec-cli/scripts/prepublish.mjs
  - package.json
related:
  - spec-cli/src/cli.ts
  - spec-cli/bin/spex.mjs
---
# packaging

SpexCode ships as a single installable npm package named `spexcode`. `npm i -g spexcode` puts **one**
command on PATH — `spex` — and nothing else the user must wire. The package carries everything the tool
needs on a machine that has never seen the source tree: the CLI itself, the `spex init` templates, and
the **prebuilt** dashboard. There is no build step on the user's machine — the launcher runs the
TypeScript directly through tsx (a real dependency here, not a dev-only tool), the same no-build stance
the dogfood repo holds.

What rides inside the tarball is an explicit `files` allowlist, not whatever happens to sit in the dir:
`src/` (the CLI + server), `templates/` (the seed `.spec` tree and the git hooks `spex init` plants),
`bin/` (the `spex` launcher), and `dashboard-dist/` — the dashboard compiled once **at publish time** by
`prepublishOnly`, never on the user's machine. The dist is built from the sibling `spec-dashboard`
package, which sits outside the tarball, so the prepublish step copies the fresh build in; the published
package is then self-contained. The same step copies the repo-root `README.md` into the package, so the
npm page renders the same docs as GitHub from one source. The private monorepo root is not the published
unit — it keeps its name out of the registry so the one public name belongs to the tool a user installs.

The natural way to run the installed tool is **two commands on two ports, deliberately kept apart** —
starting the backend never drags the UI along:

- `spex serve` — the backend (API + sessions). `--port N` sets its listen port (sugar over the `PORT` env).
- `spex dashboard` — the UI on its own port, serving the bundled dist and proxying `/api` + the terminal
  socket to a running `spex serve` (`--api-port N` names that backend). This is the post-install
  replacement for the dogfood-only `npm run web` (a vite dev server against the source tree, which an
  installed user has no copy of).

Both ports are **explicit flags**, which is what lets several projects coexist on one host:
`spex serve --port 8788` beside `spex dashboard --port 5174 --api-port 8788` runs a second instance next
to the dogfood's 8787/5173, with cwd choosing which project's `.spec` each serves — no shared default
silently collides two projects.

`spex dashboard` shares the serve-the-built-dashboard engine with [[public-mode]] — local serve is that
same gateway on loopback with no TLS and no password. The dogfood monorepo is unaffected: its root keeps
the `npm run api`/`npm run web` dev loop (vite with HMR for working *on* the dashboard), and the dist
resolver falls back to the sibling `spec-dashboard/dist` whenever no bundled copy is present.
