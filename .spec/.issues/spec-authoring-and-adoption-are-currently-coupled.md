---
concern: Future simplification record — spec-node authoring and SpexCode adoption are currently coupled
by: 16f68f90
status: open
created: 2026-08-11T00:00:00.000Z
---

This is a durable fact record for a future simplification pass. It is not an implementation proposal.

1. `spec-cli` has no single-node authoring function. Its `spex init` implementation is a complete adoption
   flow: it seeds the `.spec` scaffold, writes or stamps `spexcode.json`, installs or refreshes Git hooks, and
   runs `materialize` for harness artifacts.
2. `packages/spec-core` currently exposes the read/derived side of the spec graph. It has no spec-node write
   or authoring API.
3. Therefore, in the current code, “create one spec node” and “adopt SpexCode into a repository” are not
   separate reusable operations. They are coupled by the surrounding CLI/template flow. A future zcode import
   path should first split those responsibilities, then expose the smallest authoring operation; it should not
   move the whole adoption flow into zcode or create a second write implementation there.

Measured on the SpexCode worktree
`/home/jeffry/spexcode/.worktrees/你只做一件事-把-建-spec-节点-这件事从-Bash-shell-out-变成-zcode-16f6`, HEAD
`bd4048806e0282fdf39a4b7e3dfe767d2158727c`, with `spec-cli/src/init.ts`,
`packages/spec-core/src/specs.ts`, and both template locations present. The zcode comparison worktree was
`/home/jeffry/zcode-wt/spec-core-graph`, HEAD `3ef0911ef0ab084a187d5e277dce996e6c9e20ea`; its installed
`@spexcode/spec-core` resolved to `node_modules/@spexcode/spec-core/dist/index.js` version `0.6.3`.
