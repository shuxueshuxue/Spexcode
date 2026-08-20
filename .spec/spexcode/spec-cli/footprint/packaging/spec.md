---
title: packaging
status: active
hue: 280
desc: SpexCode's root metapackage launches compiled package artifacts; dashboard assets stay in their owning optional package.
code:
  - scripts/prepack.mjs
related:
  - package.json
  - package-lock.json
  - spec-cli/package.json
  - spec-eval/package.json
  - spec-forge/package.json
  - packages/spec-core/package.json
  - packages/session-core/package.json
  - spec-cli/src/cli.ts
  - spec-cli/bin/spex.mjs
  - spec-cli/src/node-pty-package.test.ts
---
# packaging

SpexCode's default installation contract is a single installable npm package named `spexcode`: `npm i -g
spexcode` puts **one** command on PATH — `spex` — and nothing else the user must wire. Installing it requires
Node >= 22. The root is a thin metapackage: its `files` list contains only its bin (npm includes the README
automatically), and declared dependencies select the compiled CLI closure. It does not repeat a hand-maintained
list of child package directories. `@spexcode/spec-core` remains separately published for external projects to
depend on directly.

Every runtime package ships its own `dist` and exports JavaScript from that directory. Package builds emit a
fresh sibling tree and replace `dist` only after the compile succeeds, so development readers never observe a
partially written artifact. TypeScript, tsx, Vite,
and esbuild are development/build tools only; an installed user never compiles SpexCode and does not carry
tsx or esbuild in the default install closure. The CLI package carries its templates and hooks as runtime
assets beside `dist`. Its launcher and all internal self-spawns run compiled entries through Node, so no
published callback reaches a `src/*.ts` path.
The full TypeScript compiler is deliberately not runtime cargo: it remains a development dependency for
SpexCode's own typecheck and JS anchors, while an adopter's optional JS-anchor extractor resolves that
adopter's TypeScript and fails loud when it is absent ([[code-anchor]]).

**L0 is the adoption floor, not a daemon fallback.** `spex spec lint`, `spex graph`, `spex materialize`,
`spex init`, and `spex guide` need only Node and the compiled default CLI closure, so a clean install
after `npm install --omit=optional` can start and use the spec/code asset without Hono or a native addon.
`hono`, `@hono/node-server`, `@hono/node-ws`, and `node-pty` belong to the optional daemon tier only. A
`spex serve` or `spex dashboard` without any required daemon package refuses before importing daemon code:
it names the missing packages and prints the exact `npm install ...` repair command. It never substitutes a
reduced server, hides the command, or leaks a module-resolution stack trace. The stricter CI-like install
that also uses `--ignore-scripts` suppresses esbuild's own platform-binary repair, so its probe explicitly
installs the matching `@esbuild/<platform>-<arch>` package with `--no-save --no-package-lock`; that is test
scaffolding only, not an extra normal-adopter step.

The repository holds six real workspace packages: `@spexcode/spec-core`, `@spexcode/session-core`,
`@spexcode/spec-eval`, `@spexcode/spec-forge`, `@spexcode/spec-cli`, and `@spexcode/spec-dashboard`. Their manifests name their real
package dependencies by release version; local workspace resolution is a development convenience, not a
published `file:` contract. `@spexcode/session-core` is the reusable Node-side durable session protocol;
runtime controllers supply delivery and lifecycle effects rather than becoming dependencies of the package.
`@spexcode/spec-core` has four deliberately narrow package exports. `.` is the Node-side core entry and
owns the root-explicit `readSpecs(root)` reader. `./review` is the browser-safe review domain only: its
filter, query, and session presentation functions have no Node, React, store, endpoint, or service
dependency. `./identity` is the same kind of browser-safe identity registry shared by validation and
rendering. `./graph-delta` is the browser-safe unit algebra, with no `node:*` dependency in its entire
module graph. The dashboard imports only those named pure-domain entries; it never imports `.` and therefore
cannot pull Node-only graph/store modules into Vite. No source-file subpaths are exported.

The `files` allowlist is also where this repository's own boundary is settled, so it is worth stating beside
it: the repo holds the product — the mechanism, the policy it enforces, and the tests and specs holding both
down — while what only ONE deployment knows (its hosts, its filesystem paths, the rows naming what it
publishes) lives with that deployment. The test is not "is it text" or "something similar is already here";
it is **does an adopter need this?** A file no code here reads and no adopter receives is deployment
configuration wearing the product's clothes: it reads as product to the next person and invites the next one
beside it. That is how a top-level `ops/` of nginx vhosts accumulated, and why a second vhost was later added
next to the first for no better reason than the first being there. Where a deployment must reach in, give it
a seam — a flag or a path it supplies — rather than a row; having to edit this repository to publish one more
host means the boundary was drawn in the wrong place. This rule deliberately does NOT live in the agent
contract: [[plugin-system]] keeps this repo's `.plugins` in parity with the adopter seed, so a note that only
governs this repository cannot go there without spending every adopted project's context on it.

`@spexcode/spec-dashboard` is a leaf and deliberately outside the root's default closure. It publishes two
prebuilt assets, `dist` and `dist-public`, because graph-only mode is baked at build time and [[flat]] needs
the latter without a frontend build tool. A person who wants UI installs it explicitly with
`npm install @spexcode/spec-dashboard`; a person who does not gets a smaller, fully usable writing surface.
The dashboard's own `prepack` produces both artifacts, and its tarball contains neither frontend source nor
Vite/esbuild. The CLI discovers both assets by resolving the dashboard package manifest, not by walking to a
sibling directory. An absent package fails before a UI process binds, naming that exact installation command;
an incomplete package fails with its missing artifact and a repair. It never hides commands, crashes with a
resolution stack, or serves an empty page.
The tarball carries each canonical built asset once, without transport-specific compressed copies. Installed
serving applies [[public-mode]]'s single gzip policy at the HTTP gateway, so raw asset bytes remain identical
to the package artifact while negotiated wire bytes receive the same compression and cache headers in local,
public, and host-gateway deployments.

The launcher also owns the earliest process-identity boundary for project/host control planes. Before running
the compiled CLI for `serve` or `dashboard`, it removes the invoking session's adapter-declared identity
variables from the child environment. Both installed `spex serve` and the source tree's canonical `npm run api`
route through this launcher. Ordinary session/read/write verbs keep their identity unchanged.

Release identity advances in lockstep across the complete public package set, not only the root and CLI. The
guarded [[release-publish]] action owns the release order and rejects an incomplete registry set before it can
leave public package entrypoints at different release versions. The root workspace lock metadata matches that
committed manifest graph; release publication never changes versions or lockfiles as a side effect.

The installed terminal follows the same artifact rule. `node-pty` is pinned to an upstream release whose
Darwin prebuilds publish `spawn-helper` as an executable, and a narrow dependency-artifact test verifies both
shipped Darwin helpers retain an execute bit. That prevention is deliberately not the only line of defence:
the live-terminal helper checks the exact native addon's sibling `spawn-helper` before first spawn and restores
missing execute bits idempotently. Thus an older installed dependency or a permission-losing package copy
self-repairs without asking the user to find and mutate `node_modules`; an unrepairable helper fails visibly
through [[live-view]]. This remains independent of global versus project-local placement and of host
architecture because the runtime follows `node-pty`'s loaded addon rather than constructing a prebuild path.
A package that exposes `spex` but leaves the terminal's native helper unspawnable is still not a complete
installation, so the supply-chain test stays valuable rather than being replaced by the runtime guard.

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
same gateway with no TLS and no password, on loopback unless `--host` widens it. The dogfood monorepo keeps
`npm run api` and `npm run web` as development loops, but those are not a requirement imposed on an adopter.

The packaging contract is verified as the user would meet it, not by inspecting files: CI builds the root and
dashboard tarballs, installs the root into a clean consumer project, runs `spex --help`, `spex --version`,
and `spex graph --json`, then runs `spex init --harness codex` inside a fresh git repo. The explicit harness
choice is the same first-adoption requirement [[spex-init]] owns; packaging must not introduce an implicit
default merely to make a smoke test shorter. The smoke proves the L0 verbs work without the dashboard, proves
`spex serve ui` fails with the dashboard install command in that state, then installs the dashboard tarball and
proves `spex serve ui`, `spex dashboard`, and `spex flat site` use its own static assets. A tarball that contains
the right files but cannot start from an npm install is a packaging failure.
