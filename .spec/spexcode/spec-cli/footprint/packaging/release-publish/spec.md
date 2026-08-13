---
title: release-publish
status: active
hue: 280
desc: One guarded release action publishes SpexCode's package set in dependency order at one committed version.
code:
  - scripts/release-publish.mjs
related:
  - package.json
  - packages/spec-core/package.json
  - spec-eval/package.json
  - spec-forge/package.json
  - spec-cli/package.json
  - spec-dashboard/package.json
  - .github/workflows/ci.yml
---
# release-publish

The metapackage is not a release unit by itself. A release is the committed set of six public packages:
`@spexcode/spec-core`, `@spexcode/spec-eval`, `@spexcode/spec-forge`, `@spexcode/spec-cli`,
`@spexcode/spec-dashboard`, and `spexcode`. They all carry one exact release version. Every internal package
reference, including the dashboard's build-time references, names that same version. The root remains last:
the publication order is core, dashboard, eval, forge, CLI, root. Dashboard is independent of the root's
install closure, but it is still a public installation entrypoint and belongs to the same release action. It
follows core (its only runtime dependency) and precedes CLI, so when a new CLI first tells someone to install
the dashboard package, that exact same-version repair is already resolvable from the registry.

`npm run release:check` is the local rehearsal: it validates the version/dependency graph, builds the owned
artifacts, and preflights every package tarball, so CI can execute that exact path on a change branch.
`npm run release:publish` first requires a clean checkout on `main`, then repeats the rehearsal, proves the
registry contains none of this version of the six-package set, and publishes in that order with public access.
It never edits versions, commits, tags, pushes, or repairs a partial registry state. A version found for only
some members is a loud refusal: publishing again cannot turn a partial release into a trustworthy release.

Normal `npm publish` is forbidden from the root and every member package. Their `prepublishOnly` guards accept
only the controlled release action, so the old habit cannot silently publish an inconsistent public package set.
This guard is a workflow boundary, not a promise that npm's deliberately unsafe
`--ignore-scripts` escape hatch is safe.
