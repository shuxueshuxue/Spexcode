---
title: release-artifacts
status: active
hue: 280
desc: Dashboard assets are discovered through their owning package, so UI commands use a complete installed or monorepo package and name the install repair when it is absent.
code:
  - spec-cli/src/dashboard-assets.ts
related:
  - spec-cli/src/gateway.ts
  - spec-cli/src/flat.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/cli.ts
  - spec-dashboard/package.json
  - scripts/prepack.mjs
---

# release-artifacts

The dashboard owns both its full and graph-only static builds. CLI code discovers those assets by resolving
`@spexcode/spec-dashboard/package.json`, never by walking from a CLI directory into a guessed sibling path.
That one resolution works for an installed dependency and for the workspace package.

`spex serve ui`, `spex dashboard`, public serving, and `spex flat site` ask for the owned artifact they need.
A present package with the matching built artifact is used. A source workspace that owns the package but has
not yet built it may run that package's own build script, retaining the monorepo development loop. A published
package that lacks its artifact fails plainly rather than pulling a build chain into the consumer or serving an
empty page. A missing dashboard package fails before server startup with the exact repair,
`npm install @spexcode/spec-dashboard`. The dashboard is deliberately not a dependency of the root `spexcode`
metapackage: people who want the UI opt in by installing its public package, while every writing and L0 command
remains available without it.
