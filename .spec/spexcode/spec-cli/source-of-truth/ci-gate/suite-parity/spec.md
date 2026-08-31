---
title: suite-parity
status: active
hue: 100
desc: The workflow's per-workspace suite list must equal the set of workspaces that ship tests, in both directions.
code:
  - scripts/ci-suite-parity.test.mjs
related:
  - .github/workflows/ci.yml
---
# suite-parity

[[ci-gate]] runs its unit suites one workspace at a time, so the workflow carries a hand-written list of
workspace names while the workspace set moves underneath it. That list is the only place the two facts meet,
and nothing re-checked them, so it drifted in both directions at once.

Both failures are recorded, because they are the reason this node exists:

- **A name outliving its package.** `@spexcode/terminal-ui` was folded into the dashboard and its directory
  removed, but the workflow line stayed. `npm test --workspace=` on a workspace that does not exist is a hard
  npm error, so every run died there. The gate was red for days on a package that no longer had any tests to
  run.
- **A package no name reached.** `spec-eval`, `spec-forge` and `spec-dashboard` each declare a `test` script
  and none of them was ever listed. The dashboard's 438 tests passed on developer machines and were run by
  nothing on the forge, which is indistinguishable from having no tests at all.

So the parity is asserted as a set equality, not a spot check:

- Every `--workspace=<name>` in the workflow resolves to a workspace the root manifest's globs actually expand
  to. A folded-away package fails here instead of at the npm invocation.
- Every workspace whose manifest declares a `test` script is reached by the workflow — named on a
  `--workspace=` line, or run from inside the package by a `working-directory` step, which is how the CLI's own
  integration suite runs.
- No workspace is named twice, so a merge that duplicates a line is not silently paid for in CI minutes.

The roster comes from the root manifest's `workspaces` globs, never from a second list kept here; a node that
had to be updated alongside the thing it guards would reintroduce exactly the drift it exists to catch.

This proves the workflow's *coverage*, not any suite's content. What each suite asserts belongs to its own
package's nodes.
