---
title: source-launcher-build
status: active
hue: 280
desc: A source-workspace launcher rebuilds its untracked compiled closure before it executes it.
code:
  - spec-cli/src/launcher-tsx.test.ts
related:
  - spec-cli/bin/spex.mjs
  - spec-cli/package.json
---

# source-launcher-build

The release launcher must also be usable from a clean source checkout, where each package's `dist`
directory is intentionally untracked. When the launcher finds the compiled runtime closure absent or older
than the runtime source it imports, it runs the complete ordered workspace build driver for ITS OWN workspace,
then starts `dist/cli.js`. It never imports another checkout's build and never rebuilds selectively: one
workspace, one build. The earlier design copied the main checkout's `dist` into whichever worktree ran the
launcher and rebuilt only changed packages; that made every worktree a second execution site whose bare
imports resolved only by walking up the directory tree to the main checkout's `node_modules` — an invariant
nobody had written down, which a detached worktree outside the main checkout broke in silence, and which
left forty-odd copies of the build on disk. Now there is one execution site: on a dogfood machine the PATH
`spex` is this launcher inside the main checkout, and git hooks call PATH `spex` ([[candidate-gate]],
[[main-guard]]).
Concurrent source-workspace launchers take one cross-process build lock and re-check freshness after the owner
finishes, so hooks and polling cannot start duplicate full builds.
The build covers core, forge, and CLI together: building only the CLI would leave its package imports
stale or missing. Freshness is judged against the runtime closure only: a test file beside the sources
(`*.test.ts`) is not an input, so a test-only edit never turns the launcher stale and never triggers a build.

This is source-workspace behavior, identified by the presence of `spec-cli/src`. An installed package has no
such tree and directly executes its shipped JavaScript; no consumer is asked to install or run TypeScript,
tsx, or a build script. The regression test constructs a source-shaped workspace without dist, invokes the
real launcher, and proves its workspace build produces and executes the compiled CLI. A concurrent-launcher
scenario proves the same stale closure is built exactly once across processes, and a test-edit scenario proves a
test-only change leaves the compiled closure untouched.
