---
title: doctor
status: active
hue: 160
desc: `spex doctor` — diagnose (and, later, repair) how the SpexCode workflow reaches a self-launched agent, transparently and reversibly, across every harness.
code:
  - spec-cli/src/doctor.ts
---
# doctor

## raw source

When a user launches their OWN claude/codex — no SpexCode process in the launch — the whole workflow has
to reach that agent through files the harness auto-discovers: the artifacts [[materialize]] writes. So
the question "is this agent actually governed, or silently running free?" has a concrete answer, and
`spex doctor` is the command that gives it. It DIAGNOSES the materialized contract for the current agent —
and, behind an explicit gate, will REPAIR it — keeping every footprint visible and reversible, so Spex
never silently pollutes an environment it does not own. It catches the SILENT failure on TWO axes:
UNDER-delivery (a shim present but its handler missing, a PATH that can't resolve `spex`, a contract that
never landed — the agent ungoverned while looking fine) and DOUBLE-delivery (the SAME agent reached
through two auto-discovery channels at once — the loose native delivery in the worktree AND a `spexcode`
plugin bundle the user installed independently or left behind, doubling every hook, shadowing skills).

## expanded spec

Bare `spex doctor` reports, per layer, whether the workflow truly reaches THIS agent. It loops the
[[harness-adapter]]'s `HARNESSES` (the same adapters [[materialize]] delivers through), so claude and codex
are both covered with no hardcoded paths and a new harness is diagnosed for free:

- **preconditions** — without these nothing downstream fires: `spex` (and the harness CLI) must RESOLVE on
  a bare PATH; codex needs its `~/.codex` provider/auth. A missing one is the root cause behind a dozen
  confusing symptoms.
- **contract** — the `surface:system` block is present in each harness's contract file (CLAUDE.md / AGENTS.md);
  `spex doctor contract` prints that exact text for any agent.
- **hooks** — the shim (→ `dispatch.sh`) is wired, the manifest exists in the global store
  ([[runtime-tier]]), and EVERY manifest handler script is readable in the worktree. That last check is the
  sharp one: a branch predating the hook consolidation has the shim but not the `.config/core/*` handlers,
  so hooks fire and silently no-op.
- **trust** — codex's `trusted_hash` block is in `~/.codex/config.toml` (claude relies on folder-trust).
- **git-hook floor** — pre-commit / prepare-commit-msg, enforcing for ANY agent regardless of harness.
- **backend** — orchestration reachability; absent is NORMAL for a bring-your-own-agent.
- **double-delivery** — did the contract land TWICE? The [[harness-select]] plugin-exclusivity invariant
  stops US emitting both a native and a plugin delivery, but cannot see a `spexcode` plugin bundle a user added
  out-of-band — so `doctor` catches THAT. By IDENTITY STAMP, never payload: a shim's `dispatch.sh` command line,
  a `plugin.json` `name:"spexcode"`, and our own materialized skill names. Per harness it counts three channels
  — `dispatch.sh` shims, same-named skills across the loose skillDir + plugin skills dirs, and total delivery
  sources (loose + each `spexcode` bundle under `<cfgdir>/plugins` + `~/<cfgdir>/plugins`, derived from the
  adapter's shim path so a new harness scans for free); ANY channel >1 is a conflict. `spex doctor conflicts`
  runs JUST this check, exits non-zero on a live double-delivery, and prints the repair (remove one bundle, OR
  switch `harnesses` to a plugin target so materialize prunes the loose copy, OR uninstall the loose copy).

Each layer gets a verdict (enforced / advisory-only / absent / conflict) plus a footprint audit of every
materialized artifact and any slot held by something not ours. `spex doctor install [--agent claude]
[--minimal]` will wire the materialized artifacts for a user's own agent ADDITIVELY (merging managed blocks,
never clobbering) with a manifest, and `uninstall` reverses exactly that — STAGED until the hooks degrade
safely without a managed session. `--agent` is the adapter seam: it resolves a harness by id, so codex
plugs in behind the same flag. See [[spex-init]] for repo adoption (the git-hook floor it plants).
