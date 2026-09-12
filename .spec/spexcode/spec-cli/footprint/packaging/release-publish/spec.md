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
  - packages/transcript-ui/package.json
  - packages/spec-core/package.json
  - packages/session-protocol/package.json
  - packages/session-topology/package.json
  - packages/session-runtime/package.json
  - packages/session-events/package.json
  - packages/session-application/package.json
  - spec-forge/package.json
  - spec-cli/package.json
  - spec-dashboard/package.json
  - .github/workflows/ci.yml
---
# release-publish

The metapackage is not a release unit by itself. A release is the committed set of thirteen public packages,
listed here in publication order: `@spexcode/archify`, `@spexcode/transcript`, `@spexcode/transcript-ui`,
`@spexcode/session-protocol`, `@spexcode/session-topology`, `@spexcode/session-runtime`,
`@spexcode/session-events`, `@spexcode/session-application`,
`@spexcode/spec-core`, `@spexcode/spec-dashboard`, `@spexcode/spec-forge`, `@spexcode/spec-cli`, and `spexcode`. Every public package
reference, including the dashboard's build-time references, names that same version. The root remains last:
the publication order is archify, transcript (neither depends on anything), transcript-ui, session-protocol,
session-topology, session-runtime, session-events, session-application, core, dashboard, forge,
CLI, root. archify ([[archify]]) goes first: it depends on nothing at runtime, the dashboard bundles its browser half
and the CLI renders with it, and a package that has never been published before is the one most likely to be
refused — first in line, a refusal leaves the registry untouched instead of half a release behind it. The session stack is published in dependency order;
dashboard is independent of the root's
install closure, but it is still a public installation entrypoint and belongs to the same release action. It
follows core (its only runtime dependency) and precedes CLI, so when a new CLI first tells someone to install
the dashboard package, that exact same-version repair is already resolvable from the registry.

**The root is packed from a staging copy.** npm packs a bundled dependency only when it is a real directory, and
in the workspace every `@spexcode` package is a symlink, so a root packed in place ships an empty bundle —
0.7.0-next.17's root went out as four files that could not start `spex`. The release installs the CLI's
release-internal closure, as real copies from this release's own tarballs, into a staging copy of the root and
packs and publishes the root from there; no sibling is fetched back from the registry seconds after its publish.
The rehearsal stages the root too and refuses a tarball that does not carry every package of that closure.

`npm run release:check` is the local rehearsal: it validates the version/dependency graph, compiles the whole
workspace closure once in dependency order (so a package that bundles a sibling's compiled entry at build time —
the dashboard's `@spexcode/spec-cli/ranker` — resolves it in a fresh clone where that sibling is published later),
builds the owned artifacts, and preflights every package tarball, so CI can execute that exact path on a change branch.
`npm run release:publish` first requires a clean checkout on `main`, then repeats the rehearsal, proves the
registry contains none of this version of the fourteen-package set, and publishes in that order with public access.
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
