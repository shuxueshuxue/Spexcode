---
title: self-launch package entry
status: active
hue: 280
desc: The narrow installed library and binary boundary of the self-launch adopter package.
code:
  - packages/session-selflaunch/src/index.ts
related:
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
---
# self-launch package entry

The package entry exposes adopter-owned database path and locality resolution plus one runtime seam: the explicit
native-identity binding ([[self-launch-bindings]] — bind, resolve, unbind for a protocol address). Protocol
operations remain on `@spexcode/session-protocol`; launching, probing, and materialization adapters remain outside
this package. The executable is a thin shell over the compiled CLI and the packed artifact contains only `dist`,
`bin`, and package metadata.

The package is published as `@spexcode/session-selflaunch`, version-locked with the rest of the public package set
and released through the same ordered publisher ([[release-publish]]); `npm pack` remains the input of the
installed-consumer proof.
