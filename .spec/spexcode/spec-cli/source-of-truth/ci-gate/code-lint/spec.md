---
title: code-lint
status: active
hue: 100
desc: A small ESLint config that only carries rules which have caught something; style is deliberately out of scope.
code:
  - eslint.config.mjs
related:
  - .github/workflows/ci.yml
  - package.json
---
# code-lint

Most of what a linter is normally bought for is already owned here. `tsc --noEmit` is strict and clean.
[[spec-lint]] owns the spec-to-code graph. [[dead-words]] owns product vocabulary. [[import-cycles]] owns
module structure. What none of them can see is **a binding nobody reads**, and after three refactors moved the
harness implementations around, 172 of them had accumulated — dead imports, dead helpers, a dead `useCallback`,
four dead lazy view importers under a comment still describing what they used to do.

That is the rule this config exists for. Everything else is judged against one bar: has it caught something.

## What is on

`no-unused-vars` (TypeScript-aware in `.ts`/`.tsx`, so a type-only binding is not misread), the recommended
correctness set, and React's `rules-of-hooks`. `no-dupe-keys` found `nav.spec` defined twice in both locale
files on its first run. Arguments and variables opt out by an `_` prefix; a caught error never has to be used,
because the empty-catch comment is where that intent already lives.

`react-hooks/exhaustive-deps` is a warning, not an error. The dashboard already carries
`eslint-disable-line` directives for it written against a linter that was never configured, and warning level
makes those directives mean something again without turning 22 judgement calls into a merge blocker.

## What is off, and why that is the point

`no-explicit-any` (413 hits, all deliberate boundary typing), `no-useless-escape`, `no-control-regex`,
`no-regex-spaces`, `preserve-caught-error`, `no-useless-assignment` (35 sites, several of them deliberate
initialize-then-overwrite). None of these describes a defect in this codebase; they describe a house style it
has not chosen. A gate nobody can get to zero is a gate nobody runs, and this one is at zero.

## The ignore set is derived, never listed

What must not be linted — build output, vendored trees, generated harness files, worktrees — is already
written down once, in `.gitignore`. The config reads that file and translates it. A second hand-kept list is
the exact failure this gate exists alongside: [[suite-parity]] and [[import-cycles]] were both written after a
roster drifted away from the thing it described. `.gitignore` carries no negations today, and the translation
refuses to run rather than silently mis-handle one if that changes.
