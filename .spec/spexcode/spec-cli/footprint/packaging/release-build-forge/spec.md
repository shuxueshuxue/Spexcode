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

`@spexcode/spec-forge` emits its production modules from `src` to `dist` with NodeNext resolution and
declarations. Its test files remain development-only. The CLI receives this JavaScript package through its
declared package dependency, never through a source-relative import or a consumer-side TypeScript build.
