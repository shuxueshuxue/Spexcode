---
title: tsx-test-runner
status: active
hue: 280
desc: The source-test runner resolves tsx only for repository tests; release launchers never invoke it.
code:
  - spec-cli/src/tsx-bin.ts
related:
  - spec-cli/package.json
  - spec-cli/src/session-terminal-fixture.test.ts
---

# tsx-test-runner

Source tests and direct source entrypoints sometimes run TypeScript fixtures in child processes. `tsxBin`
resolves the JavaScript entry of the repository's development dependency for that source-only path. The shared
entrypoint chooser selects `node --import tsx/esm src/{cli,index}.ts` only when the caller itself is in
`spec-cli/src`; compiled callers select `dist/{cli,index}.js` through Node. It is not part of the published package's runtime path:
release launchers and their host/session children run compiled JavaScript directly through Node.
