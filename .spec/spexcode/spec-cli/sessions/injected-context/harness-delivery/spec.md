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
serve` running. Crucially the dashboard launcher uses the **SAME** delivery: it `materialize`s into the new
worktree and then launches the agent PLAINLY — no `--append-system-prompt`, no `--settings`, no hiding of
CLAUDE.md. One path for both launch modes. Hiding CLAUDE.md (the old isolation) is gone precisely because it
also suppressed the agent's own MEMORY load; with the contract delivered by discovery instead, the agent
loads its CLAUDE.md + memory normally ([[sessions-core]] launch).

## expanded spec

`spex materialize` is the **pay-per-change render**: a pure function of the spec tree's [[surface]] nodes
into the flat artifacts each consumer reads cheaply. It is invoked by `spex init` once and thereafter ONLY
when the config content actually moved — the cheap content-hash gate lives in the dispatcher ([[hook-dispatch]]),
not a daemon. It writes, idempotently and scoped per project:

- **the hook manifest** (persistent; the [[hook-dispatch]] dispatcher reads it) — in the GLOBAL per-project
  store ([[runtime]]'s `runtimeRoot`), NOT the worktree;
- **the contract** — the `surface: system` bodies, in name order, as a `<!-- spexcode:start -->…<!-- spexcode:end -->`
  **managed block** in `<repo>/AGENTS.md` (Codex) + `<repo>/CLAUDE.md` (Claude). Only the block is owned;
  the user's own content in those files is **never touched**. This replaces the launch-time `--append-system-prompt`
  for self-launch (at user-message level — the ceiling for a discovered file, not system-prompt level);
- **the thin shims** `.claude/settings.json` + `.codex/hooks.json`: one line per harness event → the dispatcher;
- **the skills** — each `surface: skill` body as `<skillDir>/<name>/SKILL.md` (claude `.claude/skills/`, codex
  `.codex/skills/` — both ship the same `SKILL.md` primitive), loaded **on demand** by the node's
  `description`, not always-on like the contract. The dir is the adapter's `skillDir(proj)`; a harness with no
  skill primitive gets none. Gitignored like the shims (generated, no user prose);
- **the Codex trust** — a directory-trust + per-hook `trusted_hash` written ADDITIVELY into the user's GLOBAL
  `~/.codex/config.toml`, scoped to this project path. The hash is computed deterministically (the pinned
  codex-rs algorithm), so a user-self-launched codex skips its trust prompts entirely.
  Trust is global-only by codex's security design (a repo cannot declare itself trusted) — the one
  necessary scoped global write; everything else is project-local.
- **the content-hash marker** (same global store), stamped LAST so a crash mid-render re-renders next gate.

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. The shim files carry THIS
machine's absolute install path, so materialize gitignores them — a managed `#` block in `<repo>/.gitignore`
whose entries are the adapters' own `shimFile()`s **that live inside this project** (the user's existing
.gitignore is preserved) — and they re-render per machine, never committed. A shim an adapter places in
ANOTHER checkout (Codex's, at the [[harness-adapter|main checkout]]) is gitignored by that checkout's own
render instead. The contract md files stay tracked (they carry the user's prose); the
Codex trust hash is not in-tree at all — it lives in the global `~/.codex/config.toml`.

The net ideal path: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`, zero
further operation, no global pollution beyond the scoped Codex trust, no overwrite of existing contract files.
