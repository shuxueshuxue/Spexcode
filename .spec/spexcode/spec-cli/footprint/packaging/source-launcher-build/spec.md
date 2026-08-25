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

The release launcher must also be usable by repository hooks from a clean source checkout, where each
package's `dist` directory is intentionally untracked. When the launcher finds the compiled runtime closure
absent or older than the source trees it imports, it runs the workspace build before starting `dist/cli.js`.
Concurrent source-workspace launchers take one cross-process build lock and re-check freshness after the owner
finishes, so hooks and polling cannot start duplicate full builds.
The recovery covers core, eval, forge, and CLI together: building only the CLI would leave its package imports
stale or missing. Freshness is judged against the runtime closure only: a test file beside the sources
(`*.test.ts`) is not an input, so a test-only edit never turns the launcher stale and never triggers a build.

This is source-workspace behavior, identified by the presence of `spec-cli/src`. An installed package has no
such tree and directly executes its shipped JavaScript; no consumer is asked to install or run TypeScript,
tsx, or a build script. The regression test constructs a source-shaped workspace without dist, invokes the
real launcher, and proves its workspace build produces and executes the compiled CLI. A concurrent-launcher
scenario proves the same stale closure is built exactly once across processes, and a test-edit scenario proves a
test-only change leaves the compiled closure untouched.
