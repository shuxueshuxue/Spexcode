---
title: release-build-atomic
status: active
hue: 280
desc: Package builds publish a complete dist directory at once, so development readers never import a partially emitted artifact.
code:
  - scripts/build-dist.mjs
related:
  - packages/spec-core/package.json
  - spec-cli/package.json
  - spec-eval/package.json
  - spec-forge/package.json
---

# release-build-atomic

Every runtime package compiles into a fresh sibling directory. Only a successful TypeScript build replaces
its `dist`, and a failed replacement restores the prior complete artifact. Source tests and development
servers may therefore keep importing a coherent compiled package while another process builds; release
consumers still receive only the final `dist` directory.
