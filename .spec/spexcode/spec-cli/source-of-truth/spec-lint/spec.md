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

## raw source

A spec is the ground truth for the code it governs, but nothing tied the two together, so code could
drift from its spec silently. The missing edge is a `code:` list in each node's frontmatter naming the
files it owns, plus a linter over that graph. Keep the spec↔code **graph** honest; whether the code
still matches what the spec *says* is the LLM judge's job, async, not in the commit path.

## expanded spec

`spex lint` (the `spex` CLI, `cli.ts` → `lint.ts`, over `loadSpecs()` from `specs.ts`) checks four
rules:

- **integrity** (error): every file a spec lists in `code:` exists — broken links block.
- **living** (error): a body stays current-state, with no `## vN` changelog headings — version history
  is read from git (recent/history tabs), not duplicated in prose. The check is fence-aware so a
  `## v2` inside a ``` block is sample text, not a violation.
- **coverage** (warn): every governed source file (under the governed roots) is claimed by ≥1 spec —
  no orphan code.
- **drift** (warn): a governed file has commits newer than its spec's latest version → maybe stale.

No file hashes are stored — git is already the hash database, so drift is derived live from git
ancestry (commits a governed file moved ahead of the spec's latest version). The pre-commit hook is a
thin shim over `spex lint`, blocking on **errors only** (bypass with `SPEXCODE_SKIP_LINT=1`); the same
command runs in CI for real enforcement — local hooks are advisory.

A sharp edge: anything calling git from inside the hook must route through `git.ts`'s `git()` helper,
which strips the inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`; otherwise git's repo discovery
resolves to the cwd and the lint silently sees zero specs — it did once, caught only by testing through
the real hook, not by running `spex lint` by hand.

## current state

### description

`lint.ts`'s `specLint()` returns `Finding[]` over `loadSpecs()`: it builds a file→owners map while
emitting **integrity** errors for missing `code:` paths, scans each body (fence-aware `VER_HEADING`)
for **living** errors, walks `GOVERNED_ROOTS` (`spec-dashboard/src`, `spec-cli/src`; `SRC` extensions,
skipping `node_modules`/`dist`/`.vite`) for **coverage** warnings on unclaimed files, and turns each
node's `driftFiles` (computed in `specs.ts`) into **drift** warnings. `cli.ts` dispatches `spex lint`
(prints findings, exits non-zero on any error) alongside `serve`/`board`/`ls`/`watch`/`session`; the
session subcommands belong to [[sessions]] but share this same CLI entry, which is why `cli.ts` is
co-governed here. `scripts/hooks/pre-commit` is the shim: it runs `spex lint` and blocks on errors only,
honoring `SPEXCODE_SKIP_LINT=1`, and routes git through the `GIT_DIR`-stripping helper. Current run: 0
errors, drift warnings only. The LLM judge over this graph is not yet built.

### verdict — not drifted

All four governed files sit at or behind this node's latest version with no commits ahead (`spex lint`
reports no `drift` warning for `spec-lint`). `cli.ts` and `specs.ts` advanced for the session and
three-part work, which is *other* nodes' behavior; this spec deliberately scopes itself to the lint
graph and names co-governance of `cli.ts` explicitly rather than absorbing those features — so the
contract is clarified, not back-written. The raw source (a `code:` edge plus a linter over the graph;
content-correctness left to the judge) still holds.
