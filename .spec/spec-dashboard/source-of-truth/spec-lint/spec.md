---
title: spec-lint
status: active
session: sess-cmdline
hue: 175
desc: Keep the spec↔code graph honest — every code file is claimed by a spec; `spex lint` enforces it.
code:
  - spec-cli/src/lint.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/specs.ts
  - scripts/hooks/pre-commit
---
# spec-lint

A spec is the ground truth for the code it governs — but nothing tied the two together, so code
could drift away from its spec silently. Add the missing edge: a `code:` list in each node's
frontmatter naming the files it owns, and a linter over that graph.

`spex lint` (the `spex` CLI, `spec-cli/src/cli.ts` → `lint.ts`) checks three things:

- **integrity** (error): every file a spec lists in `code:` actually exists. Broken links block.
- **coverage** (warn): every governed source file is claimed by ≥1 spec — no orphan code.
- **drift** (warn): a governed file has commits newer than its spec's latest version → maybe stale.

No file hashes are stored anywhere — git already is the hash database, so drift is derived live from
`git log`. Storing hashes would force a spec edit on every code change and corrupt the meaning of
"version" (which counts only commits that touch a `spec.md`).

The pre-commit hook is a thin shim over `spex lint`: it blocks on errors only (bypass with
`SPEXCODE_SKIP_LINT=1`). The same command runs in CI for real enforcement — local hooks are advisory.
Content alignment (does the code still match what the spec *says*?) is left to the LLM judge, which
runs async on this graph, not in the commit path.

## v2 — survive the hook's git env
First version was a silent no-op *inside the hook*: git exports `GIT_DIR` (and `GIT_INDEX_FILE`) to
hook processes, which overrides git's repo discovery, so `repoRoot()`'s `rev-parse --show-toplevel`
resolved to the cwd (`spec-cli/`) instead of the worktree root → zero specs loaded → nothing linted →
every commit passed. Caught only by testing through the real hook, not by running `spex lint` by hand.
Fix lives in the general mechanism (`spec-cli/src/git.ts`): a single `git()` helper strips the
inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` so every git call discovers the repo from the
filesystem, hook or not. `layout.ts` routes through it too.
