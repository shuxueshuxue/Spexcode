---
title: forge-cli
status: active
hue: 280
desc: Exposes the link tracer on the real `spex` CLI — `spex forge links` prints node → linked issues/PRs. Read-only; reading is live.
code:
  - spec-forge/src/cli.ts
  - spec-cli/src/cli.ts
---
# forge-cli

The capstone of [[spec-forge]]: it makes the tracer *usable*. Until now the [[port]] and [[links]] were
exercised only by a standalone proof script; this exposes them on the real product surface as `spex
forge`, so a human or agent reaches the same resolution through the CLI they already use.

**Surface:**

- `spex forge links [--host github] [--node <id>] [--json]` — read the host's open issues/PRs through the
  chosen driver, resolve them against the real node ids ([[links]]), and print `node → linked work`. A
  header line reports both the link counts and how many issues/PRs were scanned (so an empty result is
  legible: nothing linked vs nothing to scan). `--node` narrows to one node; `--json` emits the raw
  resolved structure. The host is selected **through the `ForgeDriver` port** (a registry keyed by each
  driver's own `host`), never a hardcoded vendor branch — a second host is one registry entry.

Reading the forge is **live** (the driver calls `gh`), but the package is otherwise read-only: it never
writes to the forge and never mutates a node — a node's status stays git-derived. The logic lives **in
this package**; `spec-cli/src/cli.ts` carries only a thin `forge` route — a lazy `import()` of `runForge`
to which it hands `argv` — plus a help-text line, so the main CLI never bundles forge logic it isn't using.

Out of scope (sibling node): surfacing the same links in the dashboard — done CLI-first because frontend
can't be verified here.
