---
title: doctor
status: active
hue: 160
desc: `spex doctor` — one read-only project diagnosis: spec health plus proof that the workflow reaches a self-launched agent.
code:
  - spec-cli/src/doctor.ts#doctor
  - spec-cli/src/doctor.ts#specHealthDiagnosis
  - spec-cli/src/doctor.ts#doubleDeliveryReport
related:
  - spec-cli/src/doctor.test.ts
  - spec-cli/src/lint-source.test.ts
---
# doctor

## raw source

`spex doctor` is the one opt-in, read-only health diagnosis for this project. It reports heuristic spec
health without putting judgment in the deterministic commit gate, and it proves that a self-launched agent
actually receives the SpexCode workflow rather than running silently free.

When a user launches their OWN claude/codex — no SpexCode process in the launch — the whole workflow has
to reach that agent through files the harness auto-discovers: the artifacts [[harness-delivery]] writes. So
the question "is this agent actually governed, or silently running free?" has a concrete answer, and
`spex doctor` is the command that gives it. It READS the materialized contract for the current agent and
names the existing repair surface; it never mutates the repo or harness. That boundary keeps every footprint
visible and reversible, so Spex never silently pollutes an environment it does not own. It catches the SILENT failure on TWO axes:
UNDER-delivery (a shim present but its handler missing, a PATH that can't resolve `spex`, a contract that
never landed — the agent ungoverned while looking fine) and DOUBLE-delivery (the SAME agent reached
through two auto-discovery channels at once — the loose native delivery in the worktree AND a `spexcode`
plugin bundle the user installed independently or left behind, doubling every hook, shadowing skills).

One diagnosis surface keeps later semantic or agentic checks additive without minting another CLI noun or
scattering implementations across plugins.

## expanded spec

Bare `spex doctor` begins with a structured, human-readable **Spec health diagnosis**. Its checks are cheap,
advisory hypotheses, never lint findings, exit gates, or hidden plugin copies:

- **altitude** flags a spec body that looks like a mechanics dump because it is over the line/character
  budget, dense with code identifiers, or written as step-by-step how-to. Filename signals derive from the
  SAME git-tracked candidates and source policy [[spec-lint]] uses for coverage, so tracked languages and
  extensionless source participate while configured exclusions stay excluded. `doctor.altitude` in
  `spexcode.json` is the sole threshold owner (`lineBudget`, `charBudget`, `sizeable`, `dense`, `steps`, and
  optional `identifierExtensions` compatibility rows).
- **breadth** flags a node at or above `doctor.breadth.maxChildren` direct children (default 8), preserving
  the actual per-node child count as evidence and pointing at [[regroup]] for repair. A flat fan-out of real
  peers can be correct, so this is explicitly an unvalidated health hypothesis pending later ablation
  research, not deterministic graph dishonesty.

The report groups findings by check and names the affected spec, evidence, and repair; a clean tree says each
check is healthy. [[tidy]] explicitly invokes this shared report and adds semantic judgment, never reproducing
either check's thresholds.

The remainder of bare `spex doctor` reports, per layer, whether the workflow truly reaches THIS agent. It
reads the same [[harness-adapter]] registry [[harness-delivery]] materializes through:

- **preconditions** — without these nothing downstream fires: `spex` (and the harness CLI) must RESOLVE on
  a bare PATH; codex needs its `~/.codex` provider/auth. A missing one is the root cause behind a dozen
  confusing symptoms.
- **contract** — the `surface:system` block is present in each harness's contract file (CLAUDE.md / AGENTS.md);
  `spex doctor --contract` prints that exact text for any agent.
- **hooks** — the shim (→ `dispatch.sh`) is wired, the manifest exists in the global store
  ([[runtime]]), and EVERY manifest handler script is readable in the worktree. A shim without its handler
  is under-delivery even when the visible wiring looks complete.
- **trust** — codex's `trusted_hash` block is in `~/.codex/config.toml` (claude relies on folder-trust).
- **git-hook floor** — pre-commit / prepare-commit-msg, enforcing for ANY agent regardless of harness.
- **backend** — orchestration reachability; absent is NORMAL for a bring-your-own-agent.
- **settings state** — the Repo section reports the verb-less issues-workflow switch (`issues.enabled`)
  and flags no-longer-read keys instead of silently honoring them, including the move from
  `lint.maxChildren` to the sole breadth owner `doctor.breadth.maxChildren`.
- **double-delivery** — did the contract land TWICE? The [[harness-select]] plugin-exclusivity invariant
  stops US emitting both a native and a plugin delivery, but cannot see a `spexcode` plugin bundle a user added
  out-of-band — so `doctor` catches THAT. By IDENTITY STAMP, never payload: a shim's `dispatch.sh` command line,
  a `plugin.json` `name:"spexcode"`, and our own materialized skill names. Per harness it counts dispatch
  shims, same-named skills, and total loose/plugin delivery sources; ANY channel >1 is a conflict. `spex doctor --conflicts`
  runs JUST this check, exits non-zero on a live double-delivery, and prints the repair (remove one bundle, OR
  switch `harnesses` to a plugin target so materialize prunes the loose copy, OR uninstall the loose copy).

Each layer gets a verdict (enforced / advisory-only / absent / conflict) plus a footprint audit of every
materialized artifact and any slot held by something not ours. Doctor is deliberately READ-ONLY: `--contract`
and `--conflicts` are focused representations of that diagnosis, not writes. Repairs stay on the lifecycle
verbs that already own them — [[spex-init]] adopts a repo, `spex materialize` reasserts derived delivery,
[[spex-uninstall]] removes it, and [[tidy]] rewrites prose. Doctor prints those repairs but never grows
parallel install, uninstall, or release-migration actions of its own.
