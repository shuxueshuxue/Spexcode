---
title: merge-tooling-resilience
status: active
hue: 15
desc: spex survives its own source being mid-merge — every entry funnels through the launcher, which degrades to one actionable line + exit 75 instead of an esbuild stacktrace.
code:
  - spec-cli/bin/spex.mjs
  - spec-cli/src/launcher-midmerge.test.ts
related:
  - spec-cli/src/materialize.ts
  - spec-cli/src/harness.ts
  - spec-cli/templates/hooks/pre-commit
  - spec-cli/templates/hooks/post-merge
---
# merge-tooling-resilience

## raw source

The no-build stance ([[packaging]]) means every spex call parses the live TypeScript of the checkout that
hosts the package. When a dispatched merge resolves conflicts in that checkout's `spec-cli/src`, the tree
legitimately holds conflict markers for a while — and during that window every spex invocation (a manager's
`spex session done`, the Stop hook's `$SPEX` calls) used to die with a raw esbuild stacktrace, leaving agents
unable even to declare their state. A merge-in-progress is an expected transient state of the dogfood, not a
crash.

## expanded spec

Two rules make the tooling survive it:

- **One entry.** Every spex invocation goes through the launcher (`spec-cli/bin/spex.mjs`) — the PATH bin,
  the hook-baked `SPEX` (materialize + the codex launch script), and the git-hook fallbacks alike. Nothing
  bakes a raw `tsx + cli.ts` pair anymore: the launcher owns tsx resolution AND this guard, so every caller
  inherits both.
- **Graceful degradation, explicit code.** Before spawning tsx, the launcher scans the source trees the CLI
  imports (spec-cli ←→ spec-yatsu ←→ spec-forge) for conflict markers. If any file carries one, it prints a
  single actionable message naming the conflicted file(s) — "resolve the merge, then retry" — and exits
  **75** (EX_TEMPFAIL: transient, retry later). No stacktrace ever reaches the caller.

Exit 75 is the contract callers key on: the pre-commit lint shim treats it as advisory-skip (a commit
elsewhere is never walled behind a merge someone else is resolving; CI still enforces), and the stop-gate's
existing bounded block/escape paths stay clean because `$SPEX` failures now carry a real reason. This is
deliberately a stop-the-bleeding guard, not a cure: state declarations still cannot land while the merge is
unresolved — they fail fast, legibly, and retryably.
