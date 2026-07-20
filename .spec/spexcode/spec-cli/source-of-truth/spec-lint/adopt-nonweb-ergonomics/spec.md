---
title: adopt-nonweb-ergonomics
status: active
hue: 190
desc: Source coverage is one explicit set algebra over tracked regular text: roots and includes select; SpexCode data, excludes, and tests subtract; an empty result warns honestly.
code:
  - spec-cli/src/source-files.ts
related:
  - spec-cli/src/lint.ts
  - spec-cli/src/lint-source.test.ts
  - spec-eval/src/scan-source.test.ts
---

# adopt-nonweb-ergonomics

## raw source

Fresh SpexCode adoption inherited a web-only source-extension default, then risked replacing that allowlist
with a blacklist of guessed non-source names. Both shapes make SpexCode decide that a user's tracked file is
irrelevant. Source discovery must instead be a small set algebra over the repository fact SpexCode already
trusts: git-tracked current regular text. A loss signal that silently governs nothing is worse than a loud
one, but a noisy guess about README, docs, config, vendor, build, generated, or language names is not honesty.

## expanded spec

The [[spec-lint]] coverage/config seam supplies one source set to spec coverage and eval coverage:

`tracked beneath governedRoots ∩ current regular text ∩ configured includes`
`− SpexCode-owned data − configured excludes − configured tests`

- **Tracked text is authoritative.** Omitted includes mean every tracked current regular text file under
  `governedRoots`; no built-in language, directory, basename, extension, generated, or minified vocabulary
  decides relevance. Binary/non-regular/missing worktree entries cannot be source. SpexCode subtracts only
  data it owns: `.spec/**`, `.plugins/**`, `spexcode.json`, and `spexcode.local.json`.
- **Policy is data.** `lint.sourceIncludeGlobs` optionally selects a subset; `lint.sourceExcludeGlobs` and
  `lint.testGlobs` subtract from it. Each list is ordinary repo-relative globs, and a slash-less glob means
  the basename at any depth. An explicit empty include list intentionally selects nothing.
- **`sourceExtensions` is compatibility syntax, not a second path.** Leading dots are stripped and every
  extension lowers to an include glob (`py` → `**/*.py`), unioned with explicit include globs before the one
  matcher runs. Thus old projects retain exact extension selection without a branch in source discovery.
- **Python tests remain expressible without Python semantics in lint.** The configured test-glob defaults
  include `test_*.*`, `*_test.*`, test directories, and common `.test.*` / `.spec.*` names; a project may
  replace that list, including with `[]` to govern tests.
- **Zero-match is honest.** An empty result warns with the active roots, include policy, exclude globs, and
  test globs, then names the same `lint` knobs as the repair entrypoint.

`normalizeConfig` compiles extension compatibility and forgiving slash-less globs into canonical policy.
The source module consumes only that policy and never imports the language-adapter registry; language
structure and semantics remain solely behind the adapter seam.
