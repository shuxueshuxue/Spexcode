---
title: harness-delivery
status: active
hue: 280
desc: How SpexCode reaches a USER-self-launched claude/codex (no dashboard, no SpexCode process) — materialize the spec tree's surface nodes into harness-auto-discovered files, so the contract + hooks arrive with zero friction on both harnesses.
code:
  - spec-cli/src/materialize.ts#materialize
  - spec-cli/src/materialize.ts#dematerialize
related:
  - spec-cli/src/init.ts
---

# harness-delivery

## raw source

SpexCode must work for a user who installs it, runs `spex init`, and then launches **their own**
`claude`/`codex` — with **no SpexCode process in that launch**, so nothing can pass `--append-system-prompt`
or `--settings`. Therefore everything SpexCode contributes must arrive through files the harness
**auto-discovers**, and getting there must cost the user **zero further steps**. The same materialize also feeds
the dashboard path; the dashboard is one consumer, not a prerequisite — the spec engine never needs `spex
serve` running. Crucially the dashboard launcher uses the **SAME** delivery: it `materialize`s into the new
worktree and then launches the agent PLAINLY — no `--append-system-prompt`, no `--settings`, no hiding of
CLAUDE.md. One path for both launch modes. Hiding CLAUDE.md (the old isolation) is gone precisely because it
also suppressed the agent's own MEMORY load; with the contract delivered by discovery instead, the agent
loads its CLAUDE.md + memory normally ([[sessions-core]] launch).

## expanded spec

`spex materialize` is a pure function of the spec tree's [[surface]] nodes into the flat
artifacts each consumer reads cheaply. It is the **base operation of harness adaptation** — the
[[harness-adapter]] seam's render step: "adapting SpexCode to a harness" means exactly *materializing
into that harness's auto-discovery points*, so supporting a new harness is an adapter row this one
pass loops over, never a new delivery mechanism. That framing is how the verb should be explained
wherever it is defined (help, guides, onboarding docs): not a one-time setup — a re-runnable render
whose outputs are derived, untracked, and edited only via their sources. Its anchors are GIT-NATIVE only ([[commit-surgery]]): the explicit
verbs (`spex init`, `spex materialize`), session-worktree creation, and the planted pre-commit /
post-checkout / post-merge hooks — pre-commit's materialize is UNCONDITIONAL, so every materialize input
(`.plugins` content, the persisted `spexcode.json`/`spexcode.local.json`, a contract file's trackedness, a
toolchain update) is picked up no later than the next commit, and checkout/merge refresh what arrives from
other branches. A harness event is never a trigger — the old dispatcher content-hash gate is retired, and
`.plugins` edits are git-transactional (they take effect at the commit/checkout/merge that carries them,
like any other source). An environment with no planted hooks (CI, a cloud agent's fresh clone) runs
`spex materialize` in its setup step. It materializes into the harness targets
[[harness-select]] resolves from `spexcode.json` (default: every native harness), writing, idempotently and
scoped per project, for each SELECTED harness:

- **the hook manifest** (persistent; the [[hook-dispatch]] dispatcher reads it) — in the materialized tree's
  own slot (`trees/<enc-worktree>/` under [[runtime]]'s `runtimeRoot`), NOT the worktree; per-tree because
  the compile is a function of THAT tree's `.plugins` (one global slot let the last-materialized tree's hook set
  leak into every other tree's dispatch);
- **the contract** — the `surface: system` plugin bodies (in name order), assembled and written as a
  `<!-- spexcode:start -->…<!-- spexcode:end -->` block into `<repo>/AGENTS.md`
  (Codex) + `<repo>/CLAUDE.md` (Claude). Those contract files are **generated artifacts** — exactly like the
  shims + skills below: regenerated per clone/launch, never tracked, resident per [[residence]]'s live
  kind detection (exclude when wholly ours; the content filter when host prose shares the file). Plugin bodies are the ONLY contract source: there is no per-project prose file folded in, so a
project's repo-local notes cannot silently become part of every agent's contract — they live in the harness
file's own block-outside region (untracked, per-clone), while anything that must reach EVERY agent is a
plugin node. This replaces the launch-time
  `--append-system-prompt` for self-launch (at user-message level — the ceiling for a discovered file, not
  system-prompt level);
- **the shims** — each adapter's `shim().content` written to its `shimFile()`, whatever ARTIFACT that harness
  auto-discovers to wire events to the dispatcher: a thin hooks JSON for claude/codex (`.claude/settings.json`
  / `.codex/hooks.json`, one line per event), a generated event-bus plugin for opencode
  (`.opencode/plugins/spexcode.ts` — [[opencode-harness]]), or a generated extension for pi
  (`.pi/extensions/spexcode.ts` — [[pi-harness]]). materialize writes the bytes verbatim; the shape is the
  adapter's fact, not this pipeline's. The post-erase empty-dir sweep covers each artifact dir AND its parent
  (never a checkout root), since a harness may nest its shim a level below its home;
- **the skills** — each `surface: skill` body as `<skillDir>/<name>/SKILL.md` (claude `.claude/skills/`, codex
  `.codex/skills/` — both ship the same `SKILL.md` primitive), loaded **on demand** by the node's
  `description`, not always-on like the contract. The dir is the adapter's `skillDir(proj)`; a harness with no
  skill primitive gets none. Exclude-hidden like the shims (generated, no user prose);
- **the sub-agents** — each `surface: agent` body as `<agentDir>/<name>.md` (claude `.claude/agents/`), a
  harness-auto-discovered Agent-tool definition carrying the node's `desc:` load-trigger and `tools:`
  allowlist, spawned **on demand**, not always-on. Same shape as skills, one definition per harness: the dir
  is the adapter's `agentDir(proj)`; a harness with NO agent primitive (e.g. Codex today) gets none, exactly
  as `skillDir` null skips skills. Exclude-hidden like the shims + skills (generated, no user prose) — so the
  formerly-committed `.claude/agents/*.md` definitions become generated artifacts joining the same managed block;
- **the Codex trust** — a directory-trust + per-hook `trusted_hash` written ADDITIVELY into the user's GLOBAL
  `~/.codex/config.toml`, scoped to this project path. The hash is computed deterministically (the pinned
  codex-rs algorithm), so a user-self-launched codex skips its trust prompts entirely.
  Trust is global-only by codex's security design (a repo cannot declare itself trusted) — the one
  necessary scoped global write; everything else is project-local.
- **the content-hash marker** (same per-tree slot as the manifest), stamped LAST — a freshness record (a
  crash mid-materialize leaves it stale, diagnosably); the unconditional pre-commit materialize heals regardless.

The pass obeys a scoped **forgetting law**. One tree's output is exactly its current policy; shared project
output is exactly the union of successful claims from Git-registered worktrees. Local landing points are
ERASE-THEN-ASSERT by identity stamp, so narrowing one tree removes its contract/shim/skills without touching a
sibling. A small claim in the existing tree runtime slot records only what that successful pass actually
asserted; the common reconciler retains shared root hooks/trust while any registered claim needs them and
destructs them after the last claim disappears. Git registration is the lifetime truth: a missing/locked but
registered tree retains its last claim, while remove/prune releases it. Idempotence is the same-policy case,
and project-wide dematerialize clears every accessible registered tree before shared substrate. A plugin target
stays exclusive ([[plugin-harness]]) and its arbitrary bundle folders remain in the same per-tree claim.

The pass returns a **materialization receipt** alongside its content hash: the manifest and the exact contract,
shim, skill/agent, plugin-bundle, and trust paths asserted by this run. The receipt is populated at those writes,
with trust paths supplied by the adapter that performed the global write, so callers can report the selected
harness footprint without maintaining a second harness-artifact inventory.

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. Ignore is projected with
the same ownership split. Checkout-invariant machine residue (`spexcode.local.json`, `.worktrees/`, legacy
`.session`, and a claimed shared root shim) stays in the common `.git/info/exclude`. Selection-dependent local
shims, bundles, skills/agents, and wholly-ours contract files are one managed block in that tree's working
`.gitignore`. [[content-filter]] keeps a tracked host `.gitignore` pristine in the index, leaves an untracked
host file honestly visible, and lets a wholly generated one ignore itself. Contract and ignore payloads live
under the current tree slot; one common filter driver resolves the invoking Git toplevel plus `%f`, so linked
trees never overwrite one another's bytes and user global ignore configuration is untouched. The Codex trust
hash remains global and project-scoped, but its lifetime follows the registered claim union rather than
whichever tree materialized last.

The net ideal path: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`, zero
further operation, no global pollution beyond the scoped Codex trust. The contract files are SpexCode-owned
generated artifacts, so a clone never carries a stale committed copy — and the only tracked source they are
assembled from is the plugin tree, so what an agent carries is always exactly what the graph says.
