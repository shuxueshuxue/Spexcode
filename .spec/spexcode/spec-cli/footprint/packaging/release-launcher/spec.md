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

The CLI launcher executes `dist/cli.js` with Node. In a source workspace it first rebuilds the complete
runtime closure when those emitted entries are absent or older than source; direct source callers used by
development tests select their loader explicitly. An installed user never needs TypeScript or tsx to run
SpexCode, because an installed package has no source workspace and the launcher only executes its shipped
JavaScript. This keeps package ownership truthful: every package publishes the JavaScript it executes, and
the root is a metapackage rather than an alternate source layout.

The source workspace's `npm run api` builds once before it invokes that same launcher. The supervisor does
not repeat the initial build; it rebuilds only after a watched source change, before its zero-downtime swap.
