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

A spec is the ground truth for the code it governs, but nothing tied the two together,
so code could drift from its spec silently. The missing edge is a `code:` list in each
node's frontmatter naming the files it owns, plus a linter over that graph.

`spex lint` (the `spex` CLI, `spec-cli/src/cli.ts` → `lint.ts`) checks:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block.
- **living** (error): a body stays current-state, with no `## vN` changelog headings, since
  version history is read from git, not duplicated in prose.
- **coverage** (warn): every governed source file is claimed by ≥1 spec — no orphan code.
- **drift** (warn): a governed file has commits newer than its spec's latest version → maybe stale.

No file hashes are stored — git is already the hash database, so drift is derived live from
`git log`. Anything calling git from inside the hook routes through `git.ts`'s `git()` helper,
which strips the inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`; otherwise git's repo
discovery resolves to the cwd and the lint silently sees zero specs — it did once, caught only by
testing through the real hook, not by running `spex lint` by hand.

The pre-commit hook is a thin shim over `spex lint`, blocking on errors only (bypass with
`SPEXCODE_SKIP_LINT=1`); the same command runs in CI for real enforcement — local hooks are
advisory. Whether the code still matches what the spec *says* is left to the LLM judge, which runs
async over this graph, not in the commit path.
