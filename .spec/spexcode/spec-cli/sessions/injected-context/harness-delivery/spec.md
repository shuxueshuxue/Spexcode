---
title: harness-delivery
status: active
hue: 280
desc: How SpexCode reaches a USER-self-launched claude/codex (no dashboard, no SpexCode process) — render the spec tree's surface nodes into harness-auto-discovered files, so the contract + hooks arrive with zero friction on both harnesses.
code:
  - spec-cli/src/materialize.ts
related:
  - spec-cli/src/init.ts
---

# harness-delivery

## raw source

SpexCode must work for a user who installs it, runs `spex init`, and then launches **their own**
`claude`/`codex` — with **no SpexCode process in that launch**, so nothing can pass `--append-system-prompt`
or `--settings`. Therefore everything SpexCode contributes must arrive through files the harness
**auto-discovers**, and getting there must cost the user **zero further steps**. The same render also feeds
the dashboard path; the dashboard is one consumer, not a prerequisite — the spec engine never needs `spex
serve` running.

## expanded spec

`spex materialize` is the **pay-per-change render**: a pure function of the spec tree's [[surface]] nodes
into the flat artifacts each consumer reads cheaply. It is invoked by `spex init` once and thereafter ONLY
when the config content actually moved — the cheap content-hash gate lives in the dispatcher ([[hook-dispatch]]),
not a daemon. It writes, idempotently and scoped per project:

- **the hook manifest** `.spexcode/hooks-manifest` (persistent; the [[hook-dispatch]] dispatcher reads it);
- **the contract** — the `surface: system` bodies, in name order, as a `<!-- spexcode:start -->…<!-- spexcode:end -->`
  **managed block** in `<repo>/AGENTS.md` (Codex) + `<repo>/CLAUDE.md` (Claude). Only the block is owned;
  the user's own content in those files is **never touched**. This replaces the launch-time `--append-system-prompt`
  for self-launch (it lands at user-message level — the harness ceiling for a discovered file, not system-prompt level);
- **the thin shims** `.claude/settings.json` + `.codex/hooks.json`: one line per harness event → the dispatcher;
- **the Codex trust** — a directory-trust + per-hook `trusted_hash` written ADDITIVELY into the user's GLOBAL
  `~/.codex/config.toml`, scoped to this project path. The hash is computed deterministically (the codex-rs
  algorithm, reverse-engineered + pinned), so a user-self-launched codex skips its trust prompts entirely.
  Trust is global-only by codex's security design (a repo cannot declare itself trusted) — this is the one
  necessary, minimal, scoped global write; everything else is project-local.
- **the content-hash marker** `.spexcode/content-hash`, stamped LAST so a crash mid-render re-renders next gate.

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. The shim files and the
trust hash carry machine-absolute paths, so they are gitignored and re-rendered per machine — never committed.

The net ideal path is: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`,
zero further operation, no global pollution beyond the scoped Codex trust, no overwrite of existing contract files.
