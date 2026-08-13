---
title: release-build-cli
status: active
hue: 280
desc: The CLI package compiles its NodeNext source tree into the JavaScript artifact it publishes and runs.
code:
  - spec-cli/tsconfig.build.json
related:
  - spec-cli/package.json
  - scripts/prepack.mjs
  - spec-cli/src/anchors.test.ts
---

# release-build-cli

`@spexcode/spec-cli` emits `src` as `dist` under NodeNext resolution, including declarations for its public
modules. Tests remain source-only and are excluded from the release artifact. The emitted tree is the one its
launcher executes and the one its package manifest publishes; no consumer compiles this source tree.
