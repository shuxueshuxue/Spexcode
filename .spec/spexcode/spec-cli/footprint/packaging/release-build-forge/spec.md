---
title: release-build-forge
status: active
hue: 280
desc: The forge package compiles its NodeNext source tree into the JavaScript artifact consumed by the CLI.
code:
  - spec-forge/tsconfig.build.json
related:
  - spec-forge/package.json
  - scripts/prepack.mjs
---

# release-build-forge

The shared [[packaging]] package-build invariant applies here. This leaf supplies the forge-specific delta:
`spec-forge/tsconfig.build.json` compiles `@spexcode/spec-forge` for the JavaScript artifact consumed by the CLI.
