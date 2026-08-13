---
title: release-launcher
status: active
hue: 280
desc: The root npm package is a thin launcher that delegates to the compiled CLI package and never carries or compiles TypeScript at runtime.
code:
  - bin/spex.mjs
related:
  - package.json
  - spec-cli/bin/spex.mjs
  - spec-cli/package.json
---

# release-launcher

The public `spexcode` package owns one executable, `spex`. Its launcher contains no product runtime and
delegates to `@spexcode/spec-cli`'s own launcher. The root package therefore ships only that executable,
its README, and dependencies chosen by its manifest; it does not keep a second hand-maintained inventory of
child package directories.

The CLI launcher executes `dist/cli.js` with Node. TypeScript and tsx may remain development tools; a direct
source caller selects them explicitly to run `src/{cli,index}.ts`, while every compiled caller selects its
matching `dist` entry. An installed user never needs either to run SpexCode. This keeps package ownership
truthful: every package publishes the JavaScript it executes, and the root is a metapackage rather than an
alternate source layout.

The source workspace's `npm run api` builds once before it invokes that same launcher. The supervisor does
not repeat the initial build; it rebuilds only after a watched source change, before its zero-downtime swap.
