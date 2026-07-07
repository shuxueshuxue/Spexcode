---
title: adopt-nonweb-ergonomics
status: active
hue: 190
desc: A non-web adopter's coverage config never fails SILENTLY — a zero-match state is a self-explanatory repair entrypoint naming both knobs, and forgiving input (dotted extensions, slash-less test globs) is normalized instead of matching nothing.
related:
  - spec-cli/src/lint.ts
---

# adopt-nonweb-ergonomics

## raw source

Adopting SpexCode on a non-web project (Rust/Go/Python) kept hitting the same dead end: coverage
enumerated zero source files and the board read falsely clean, or the warning misdiagnosed the fix.
Three distinct config mistakes all collapse to one silent symptom — **zero files matched, no signal
why**. A loss signal that silently governs nothing is worse than a loud one, so every zero-match path
must become a self-explanatory repair entrypoint or be normalized to what the adopter obviously meant.

## expanded spec

Three footguns, all of the class *config silently matches zero files*, fixed at the [[spec-lint]]
coverage/config seam so both coverage and yatsu's uncovered check inherit the fix:

- **Zero-match is a repair entrypoint, not a dead end.** When coverage finds no source at all, the
  "governing NOTHING" warning echoes the *current* `sourceExtensions` and `governedRoots` values (so the
  mismatch is visible — hunting `ts` in a `py` tree), names BOTH knobs, states they nest under the `lint`
  key (a top-level key silently no-ops), and gives copy-pasteable non-web examples. The warning IS the fix.
- **A leading dot on an extension is normalized.** The matcher anchors on `.ext`, so a literal `.py`
  extension matches nothing; leading dots are stripped so `py` and `.py` both work — the prose long showed
  dotted forms, so this accepts what the adopter read rather than punishing it.
- **A slash-less test glob is widened to any depth.** Globs anchor to the full repo-relative path, so a
  bare `*.test.py` matches only ROOT-level files and leaks every nested test into coverage; a slash-less
  glob gets a `**/` prefix so it matches that basename at any depth, as the default already does.

The two normalizations live in `normalizeConfig`, applied inside `loadConfig` — the single seam every
consumer reads through, so coverage, the uncovered check, and altitude all see canonical values.
