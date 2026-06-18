---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
---
# spec-cli

One of three SpexCode packages (with spec-dashboard and spec-yatsu). Hono + tsx, no build step.

Reads the `.spec` tree and its git history and serves `/api/specs`, `/api/specs/:id/history`,
`/api/layout`. Ships the `spex` CLI (`spex lint`, `spex serve`) and the main-guard / spec-lint
pre-commit guards. The **source-of-truth** subtree — how `.spec` stays canonical (git-as-database,
the worktree linker, the guards, the linter) — lives under here, where it belongs, rather than under
the dashboard.
