---
title: forge-cli
status: active
hue: 280
desc: Exposes spec-forge's reads on the real `spex` CLI — `spex forge links` (node → linked issues/PRs) and `spex forge eval-pending` (node → evaluation owed). Read-only; reading is live.
code:
  - spec-forge/src/cli.ts
related:
  - spec-cli/src/cli.ts
---
# forge-cli

The capstone of [[spec-forge]]: it makes the tracer *usable*. Until now the [[port]] and [[links]] were
exercised only by a standalone proof script; this exposes spec-forge's reads on the real product surface as
`spex forge <sub>`, so a human or agent reaches the same resolution through the CLI they already use.

**Surface:**

- `spex forge links [--host github] [--node <id>] [--json]` — read the host's open issues/PRs through the
  chosen driver, resolve them against the real node ids ([[links]]), and print `node → linked work`. A
  header line reports both the link counts and how many issues/PRs were scanned (so an empty result is
  legible: nothing linked vs nothing to scan). `--node` narrows to one node; `--json` emits the raw
  resolved structure.
- `spex forge eval-pending [--host github] [--node <id>] [--json]` — the same read, resolved instead to the
  open issues flagged `needs-yatsu-eval`, printed as `node → evaluation owed` with the same header and
  `--node`/`--json` flags so the two reports read alike. The flag-recognition and node-resolution semantics
  are [[needs-yatsu-eval]]'s; this is only its CLI exposure. `--json` emits the raw `NodeEvalPending[]` —
  the shape `spex yatsu scan` consumes.

Both verbs share one read — select the host's driver **through the `ForgeDriver` port** (a registry keyed by
each driver's own `host`, never a hardcoded vendor branch — a second host is one registry entry), load the
canonical node ids, fetch the host's open issues/PRs — factored into `readForge`, so a third verb is just a
resolver plus a printer.

Reading the forge is **live** (the driver calls `gh`), but the package is otherwise read-only: it never
writes to the forge and never mutates a node — a node's status stays git-derived. The logic lives **in
this package**; `spec-cli/src/cli.ts` carries only a thin `forge` route — a lazy `import()` of `runForge`
to which it hands `argv` — plus the `forge` help-text line, so the main CLI never bundles forge logic it
isn't using. A neighbouring verb's churn in that shared hub — the `yatsu` usage line rewritten when yatsu
was reframed to measure-and-score — moves the file but is that feature's, not forge-cli's drift.

Out of scope (sibling node): surfacing the same links in the dashboard — done CLI-first because frontend
can't be verified here.
