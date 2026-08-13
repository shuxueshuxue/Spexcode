---
title: merge-tooling-resilience
status: active
hue: 15
desc: spex survives an in-progress source-workspace merge - every entry funnels through the launcher, which degrades to one actionable line + exit 75 instead of running stale artifacts.
code:
  - spec-cli/bin/spex.mjs
related:
  - spec-cli/src/materialize.ts
  - spec-cli/src/harness.ts
  - spec-cli/templates/hooks/pre-commit
  - spec-cli/templates/hooks/post-merge
  - spec-cli/src/launcher-midmerge.test.ts
---
# merge-tooling-resilience

## raw source

A source workspace can be mid-merge while its last compiled CLI artifact is still present. When a dispatched
merge resolves conflicts in `spec-cli/src`, every hook and callback must see one retryable condition, not run
stale code or die with a raw stack trace. A merge-in-progress is an expected transient state of the dogfood,
not a crash.

## expanded spec

Two rules make the tooling survive it:

- **One entry.** Every spex invocation goes through the launcher (`spec-cli/bin/spex.mjs`) - the PATH bin,
  the hook-baked `SPEX` (materialize + the codex launch script), and the git-hook fallbacks alike. Nothing
  bakes a raw source entry: the launcher owns compiled execution and this guard, so every caller inherits both.
- **Graceful degradation, explicit code.** When `spec-cli/src` exists, the launcher scans the source trees the
  CLI imports (spec-cli <- spec-eval <- spec-forge) for conflict markers. If any file carries one, it prints a
  single actionable message naming the conflicted file(s) - "resolve the merge, rebuild SpexCode, then retry" -
  and exits **75** (EX_TEMPFAIL: transient, retry later). A published package has no source tree to scan and
  executes its shipped `dist` directly.

Exit 75 is the contract callers key on: the pre-commit lint shim treats it as advisory-skip (a commit
elsewhere is never walled behind a merge someone else is resolving; CI still enforces), and the stop-gate's
existing bounded block/escape paths stay clean because `$SPEX` failures now carry a real reason. This is
deliberately a stop-the-bleeding guard, not a cure: state declarations still cannot land while the merge is
unresolved — they fail fast, legibly, and retryably.
