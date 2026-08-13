---
title: release-publish-test
status: active
hue: 280
desc: Release publication guards are tested against the live package graph and controlled registry states.
code:
  - scripts/release-publish.test.mjs
related:
  - scripts/release-publish.mjs
---
# release-publish-test

The release test derives its expected package order and version references from the producer's declared set.
It covers the actual committed manifests, the controlled partial-registry refusal, and a real package-directory
`npm publish --dry-run` rejection. It also proves a node branch's release command stops before a build or
registry contact. An accidental new package, a stale internal version, a missing direct-publish guard, a branch
release, an invalid release version, or a retry after a partial publication therefore fails before a real npm
write.
