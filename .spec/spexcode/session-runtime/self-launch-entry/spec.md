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

The package entry exposes only adopter-owned database path and locality resolution. Protocol operations remain on
`@spexcode/session-protocol`; runtime and materialization adapters remain outside this package. The executable is a
thin shell over the compiled CLI and the packed artifact contains only `dist`, `bin`, and package metadata.

The package is private at this milestone even though `npm pack` is used for installation proof. Publication scope
and release automation remain later roadmap decisions, so this node does not add the package to repository release
scripts or root workspace metadata.
