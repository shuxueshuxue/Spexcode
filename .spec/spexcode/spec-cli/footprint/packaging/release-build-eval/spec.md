---
title: release-build-eval
status: active
hue: 280
desc: The eval package compiles its NodeNext source tree into the JavaScript artifact consumed by the CLI.
code:
  - spec-eval/tsconfig.build.json
related:
  - spec-eval/package.json
  - scripts/prepack.mjs
---

# release-build-eval

The shared [[packaging]] package-build invariant applies here. This leaf supplies the eval-specific delta:
`spec-eval/tsconfig.build.json` compiles `@spexcode/spec-eval` for the JavaScript artifact consumed by the CLI.
