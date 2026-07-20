---
title: adopt-nonweb-ergonomics
status: active
hue: 190
desc: Fresh adoption discovers ordinary source across languages from git-tracked files, with explicit generic exclusions, preserved overrides, and honest empty-set diagnostics.
code:
  - spec-cli/src/source-files.ts
related:
  - spec-cli/src/lint.ts
  - spec-cli/src/lint-source.test.ts
---

# adopt-nonweb-ergonomics

## raw source

Fresh SpexCode adoption inherited a web-only source-extension default. A Python, Rust, Go, or mixed
project could therefore enumerate no source files and present a falsely clean coverage signal. Source
discovery must begin from the repository fact SpexCode already trusts — git-tracked files — and apply a
small, explicit policy that recognizes ordinary source without teaching lint an ever-growing language
list. A loss signal that silently governs nothing is worse than a loud one.

## expanded spec

The [[spec-lint]] coverage/config seam supplies one source universe to coverage and eval coverage. Its
source-discovery module classifies paths and bytes only; it neither parses languages nor reaches into the
language-adapter registry, whose sole responsibility remains language-specific structure and semantics.

- **Git-tracked files are the universe.** Default discovery considers tracked files beneath
  `governedRoots`, then removes explicit non-source categories: vendored dependencies, generated and
  build outputs, docs, binary/assets, metadata, and conventional tests. Ordinary text source in common
  languages therefore participates without a per-language branch in lint. Language-specific parsing
  and semantics stay in the ordered language-adapter registry.
- **Project overrides remain authoritative.** An explicit `lint.sourceExtensions` narrows discovery to
  exactly those extensions; `governedRoots` and `testGlobs` retain their existing roles. Defaults make a
  fresh adoption useful, while configuration can still express an intentionally narrow project.
- **Python test conventions are non-product by default.** Language-neutral test patterns cover conventional
  test directories plus `test_*.*` / `*_test.*`, so Python's `test_*.py` and `*_test.py` forms work without
  a Python branch; common `.test.*` / `.spec.*` forms remain excluded too.
- **Zero-match is honest.** If the resulting candidate set is empty, lint emits a coverage warning that
  names the active roots and source policy, distinguishes defaults from an explicit extension override,
  and points at the `lint` knobs that repair an intentional mismatch.

- **A leading dot on an extension is normalized.** The matcher anchors on `.ext`, so a literal `.py`
  extension matches nothing; leading dots are stripped so `py` and `.py` both work — the prose long showed
  dotted forms, so this accepts what the adopter read rather than punishing it.
- **A slash-less test glob is widened to any depth.** Globs anchor to the full repo-relative path, so a
  bare `*.test.py` matches only ROOT-level files and leaks every nested test into coverage; a slash-less
  glob gets a `**/` prefix so it matches that basename at any depth, as the default already does.

The two normalizations live in `normalizeConfig`, applied inside `loadConfig` — the single seam every
consumer reads through, so coverage, the uncovered check, and altitude all see canonical values.
