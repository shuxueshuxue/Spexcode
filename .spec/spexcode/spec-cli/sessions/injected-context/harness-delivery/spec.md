---
title: harness-delivery
status: active
hue: 280
desc: How SpexCode reaches a USER-self-launched claude/codex (no dashboard, no SpexCode process) — materialize the spec tree's surface nodes into harness-auto-discovered files, so the contract + hooks arrive with zero friction on both harnesses.
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
- **the contract** — the tracked **docs guide** (`docs/AGENT_GUIDE.md` — the project's hand-written agent/
  contributor notes, the ONE piece of in-tree contract prose) FOLLOWED BY the `surface: system` bodies (in name
  order), assembled and written as a `<!-- spexcode:start -->…<!-- spexcode:end -->` block into `<repo>/AGENTS.md`
  (Codex) + `<repo>/CLAUDE.md` (Claude). Those contract files are **generated artifacts** — exactly like the
  shims + skills below: regenerated per clone/launch, never tracked, resident per [[residence]]'s live
  kind detection (exclude when wholly ours; the content filter when host prose shares the file). The guide
  SOURCE is the only
  tracked contract prose; folding it INTO the generated file is what guarantees a self-launched agent still
  discovers guide + contract together (nothing is lost by un-tracking the file). This replaces the launch-time
  `--append-system-prompt` for self-launch (at user-message level — the ceiling for a discovered file, not
  system-prompt level);
- **the thin shims** `.claude/settings.json` + `.codex/hooks.json`: one line per harness event → the dispatcher;
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

The pass obeys the **forgetting law**: materialize(P₂) ∘ materialize(P₁) = materialize(P₂) — whatever a
prior policy (harness set, a retired render-vote mode, or older legacy modes) wrote, one materialize under the
current policy fully forgets it; idempotence is the special case P₂ = P₁, and **dematerialize =
materialize(∅)** is the empty policy [[spex-uninstall]] builds on. The shape is ERASE-THEN-ASSERT over a
CLOSED set of landing points: each is first erased unconditionally by its IDENTITY STAMP — the sentinel
blocks, the shim's own `dispatch.sh` command line, the generated mark on skills/agents (which is also what
lets a RENAMED or deleted node's product be forgotten), the content-filter config namespace, the legacy
skip-worktree bit — then rewritten per the current policy, possibly to nothing. No ledger of past states,
no pairwise migration branches: the erase IS the migration. So an UNSELECTED harness needs no separate
prune pass — the erase already forgot it and only selected harnesses are asserted ([[harness-adapter]]'s
`clean()` remains the per-harness surgical inverse the erase is built from). The erase order carries one
constraint: managed blocks leave the working contract files BEFORE the content filter's config goes
([[content-filter]] edge 3). A plugin target stays exclusive ([[plugin-harness]]); its bundle FOLDERS are
arbitrary paths no stamp can enumerate, so they keep the one small ledger of last-emitted folders (in the
same per-tree slot as the manifest) — the single landing point outside the stamp-erasable set.

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. The materialize's ignore
rules are one managed `#` block in the per-clone `.git/info/exclude` — the host's tracked `.gitignore` is
never touched ([[residence]]) — carrying the MACHINE facts (the adapters' `shimFile()`s, which bake
THIS machine's absolute install path; any plugin bundle dir; `spexcode.local.json`; and the session
residue: `.worktrees/` — where a launch plants its worktrees — plus a legacy `.session` entry for
worktrees an old backend labeled with the retired per-worktree state file; live session state is the
global store's `session.json`), the materialized skills/agents, and the wholly-ours contract files; a
tracked-or-mixed contract file is the [[content-filter]]'s domain instead, never an exclude entry. The
block is **checkout-invariant**: the exclude lives in the COMMON git dir shared by the main checkout and
every worktree, so if the entries differed by where materialize ran the two passes would fight. The only
entry that varies is Codex's hooks shim, which an adapter places at the [[harness-adapter|main checkout]]
(a worktree's codex reads the root's hooks): from main it is `.codex/hooks.json`, from a worktree it
escapes `proj` (`../…`). So each entry is anchored to the checkout it LIVES under — project-relative when
inside `proj`, else main-checkout-relative — which resolves that shim to `.codex/hooks.json` from ANY
checkout (a pattern naming a main-only path is a harmless no-op in a worktree). Every checkout emits the
identical block. The Codex trust hash is not in-tree at all — it lives in the global `~/.codex/config.toml`.

The net ideal path: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`, zero
further operation, no global pollution beyond the scoped Codex trust. The contract files are SpexCode-owned
generated artifacts, so a clone never carries a stale committed copy — any
hand-written contract prose lives in the tracked `docs/AGENT_GUIDE.md` source, which the materialize folds back in.
