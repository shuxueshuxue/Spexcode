---
title: release-publish
status: active
hue: 280
desc: One guarded release action publishes SpexCode's package set in dependency order at one committed version.
code:
  - scripts/release-publish.mjs
related:
  - package.json
  - packages/transcript/package.json
  - packages/spec-core/package.json
  - packages/session-protocol/package.json
  - packages/session-topology/package.json
  - packages/session-runtime/package.json
  - packages/session-events/package.json
  - packages/session-application/package.json
  - packages/session-selflaunch/package.json
  - spec-eval/package.json
  - spec-forge/package.json
  - spec-cli/package.json
  - spec-dashboard/package.json
  - .github/workflows/ci.yml
---
# release-publish

The metapackage is not a release unit by itself. A release is the committed set of thirteen public packages:
`@spexcode/transcript`, `@spexcode/session-protocol`, `@spexcode/session-topology`, `@spexcode/session-runtime`, `@spexcode/session-events`,
`@spexcode/session-application`, `@spexcode/session-selflaunch`, `@spexcode/spec-core`, `@spexcode/spec-eval`,
`@spexcode/spec-forge`, `@spexcode/spec-cli`, `@spexcode/spec-dashboard`, and `spexcode`. Every public package
reference, including the dashboard's build-time references, names that same version. The root remains last:
the publication order is transcript (it depends on nothing), session-protocol, session-topology, session-runtime, session-events, session-application,
session-selflaunch, core, dashboard, eval, forge, CLI, root. The session stack is published in dependency order;
dashboard is independent of the root's
install closure, but it is still a public installation entrypoint and belongs to the same release action. It
follows core (its only runtime dependency) and precedes CLI, so when a new CLI first tells someone to install
the dashboard package, that exact same-version repair is already resolvable from the registry.

`npm run release:check` is the local rehearsal: it validates the version/dependency graph, builds the owned
artifacts, and preflights every package tarball, so CI can execute that exact path on a change branch.
`npm run release:publish` first requires a clean checkout on `main`, then repeats the rehearsal, proves the
registry contains none of this version of the thirteen-package set, and publishes in that order with public access.
The dist-tag is derived from the committed version, never chosen by hand: a prerelease version
(`0.7.0-next.0`, any `-` suffix) publishes every member under `next`, so `npm i spexcode` keeps resolving the last
stable release while an adopter that opted in with `@next` receives the whole set at once; a stable version moves
`latest`. One committed version therefore means one registry state, and a prerelease line can iterate on `next`
without touching what existing installs receive.
It never edits versions, commits, tags, pushes, or repairs a partial registry state. A version found for only
some members is a loud refusal: publishing again cannot turn a partial release into a trustworthy release.

Normal `npm publish` is forbidden from the root and every member package. Their `prepublishOnly` guards accept
only the controlled release action, so the old habit cannot silently publish an inconsistent public package set.
This guard is a workflow boundary, not a promise that npm's deliberately unsafe
`--ignore-scripts` escape hatch is safe.
