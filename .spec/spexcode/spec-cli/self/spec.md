---
title: self
status: active
hue: 160
desc: `spex self` — diagnose (and, later, repair) how the SpexCode workflow reaches a self-launched agent, transparently and reversibly, across every harness.
code:
  - spec-cli/src/self.ts
---
# self

## raw source

When a user launches their OWN claude/codex — no SpexCode process in the launch — the whole workflow has
to reach that agent through files the harness auto-discovers: the artifacts [[materialize]] renders. So
the question "is this agent actually governed, or silently running free?" has a concrete answer, and
`spex self` is the command that gives it. It DIAGNOSES the materialized contract for the current agent —
and, behind an explicit gate, will REPAIR it — keeping every footprint visible and reversible, so Spex
never silently pollutes an environment it does not own. The failure it exists to catch is the SILENT one:
a hook shim present but its handler missing, a PATH that can't resolve `spex`, a contract that never
landed — each of which leaves the agent ungoverned while looking fine.

## expanded spec

`spex self doctor` reports, per layer, whether the workflow truly reaches THIS agent. It loops the
[[harness-adapter]]'s `HARNESSES` (the same adapters [[materialize]] renders through), so claude and codex
are both covered with no hardcoded paths and a new harness is diagnosed for free:

- **preconditions** — without these nothing downstream fires: `spex` (and the harness CLI) must RESOLVE on
  a bare PATH; codex needs its `~/.codex` provider/auth. A missing one is the root cause behind a dozen
  confusing symptoms.
- **contract** — the `surface:system` block is present in each harness's contract file (CLAUDE.md / AGENTS.md);
  `spex self contract` prints that exact text for any agent.
- **hooks** — the shim (→ `dispatch.sh`) is wired, the manifest exists in the global store
  ([[runtime-tier]]), and EVERY manifest handler script is readable in the worktree. That last check is the
  sharp one: a branch predating the hook consolidation has the shim but not the `.config/core/*` handlers,
  so hooks fire and silently no-op.
- **trust** — codex's `trusted_hash` block is in `~/.codex/config.toml` (claude relies on folder-trust).
- **git-hook floor** — pre-commit / prepare-commit-msg, enforcing for ANY agent regardless of harness.
- **backend** — orchestration reachability; absent is NORMAL for a bring-your-own-agent.

Each layer gets a verdict (enforced / advisory-only / absent / conflict) plus a footprint audit of every
materialized artifact and any slot held by something not ours. `spex self install [--agent claude]
[--minimal]` will wire the materialized artifacts for a user's own agent ADDITIVELY (merging managed blocks,
never clobbering) with a manifest, and `uninstall` reverses exactly that — STAGED until the hooks degrade
safely without a managed session. `--agent` is the adapter seam: it resolves a harness by id, so codex
plugs in behind the same flag. See [[spex-init]] for repo adoption (the git-hook floor it plants).
