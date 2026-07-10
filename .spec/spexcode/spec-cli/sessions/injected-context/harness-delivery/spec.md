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
when the render's inputs actually moved — the cheap content-hash gate lives in the dispatcher
([[hook-dispatch]]), not a daemon, and its key covers BOTH inputs: the config content AND the **renderer's
own version** (a toolchain-side content fingerprint — a source checkout's package tree-hash, an npm
install's package version). The artifacts are a function of (config, renderer), so a toolchain update moves
the key and the next gate self-heals the stale contract/shims/manifest — previously an updated deploy
stayed stale until someone happened to edit `.config`. It renders into the harness targets
[[harness-select]] resolves from `spexcode.json` (default: every native harness), writing, idempotently and
scoped per project, for each SELECTED harness:

- **the hook manifest** (persistent; the [[hook-dispatch]] dispatcher reads it) — in the GLOBAL per-project
  store ([[runtime]]'s `runtimeRoot`), NOT the worktree;
- **the contract** — the tracked **docs guide** (`docs/AGENT_GUIDE.md` — the project's hand-written agent/
  contributor notes, the ONE piece of in-tree contract prose) FOLLOWED BY the `surface: system` bodies (in name
  order), assembled and written as a `<!-- spexcode:start -->…<!-- spexcode:end -->` block into `<repo>/AGENTS.md`
  (Codex) + `<repo>/CLAUDE.md` (Claude). Those contract files are **generated artifacts** — exactly like the
  shims + skills below: regenerated per clone/launch, and how they sit relative to the shared repo is the
  [[render-policy]] vote (default: gitignored). The guide SOURCE is the only
  tracked contract prose; folding it INTO the generated file is what guarantees a self-launched agent still
  discovers guide + contract together (nothing is lost by un-tracking the file). This replaces the launch-time
  `--append-system-prompt` for self-launch (at user-message level — the ceiling for a discovered file, not
  system-prompt level);
- **the thin shims** `.claude/settings.json` + `.codex/hooks.json`: one line per harness event → the dispatcher;
- **the skills** — each `surface: skill` body as `<skillDir>/<name>/SKILL.md` (claude `.claude/skills/`, codex
  `.codex/skills/` — both ship the same `SKILL.md` primitive), loaded **on demand** by the node's
  `description`, not always-on like the contract. The dir is the adapter's `skillDir(proj)`; a harness with no
  skill primitive gets none. Gitignored like the shims (generated, no user prose);
- **the sub-agents** — each `surface: agent` body as `<agentDir>/<name>.md` (claude `.claude/agents/`), a
  harness-auto-discovered Agent-tool definition carrying the node's `desc:` load-trigger and `tools:`
  allowlist, spawned **on demand**, not always-on. Same shape as skills, one definition per harness: the dir
  is the adapter's `agentDir(proj)`; a harness with NO agent primitive (e.g. Codex today) gets none, exactly
  as `skillDir` null skips skills. Gitignored like the shims + skills (generated, no user prose) — so the
  formerly-committed `.claude/agents/spec-scout.md` becomes a generated artifact joining the same managed block;
- **the Codex trust** — a directory-trust + per-hook `trusted_hash` written ADDITIVELY into the user's GLOBAL
  `~/.codex/config.toml`, scoped to this project path. The hash is computed deterministically (the pinned
  codex-rs algorithm), so a user-self-launched codex skips its trust prompts entirely.
  Trust is global-only by codex's security design (a repo cannot declare itself trusted) — the one
  necessary scoped global write; everything else is project-local.
- **the content-hash marker** (same global store), stamped LAST so a crash mid-render re-renders next gate.

The render obeys the **forgetting law**: materialize(P₂) ∘ materialize(P₁) = materialize(P₂) — whatever a
prior policy (harness set, [[render-policy]] vote, or a retired legacy mode) wrote, one render under the
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
arbitrary paths no stamp can enumerate, so they keep the one small ledger of last-emitted folders — the
single landing point outside the stamp-erasable set.

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. The render's ignore
rules are one managed `#` block carrying two entry classes ([[render-policy]]): the MACHINE facts — the
adapters' `shimFile()`s (they bake THIS machine's absolute install path), any plugin bundle dir,
`spexcode.local.json`, and the session residue (`.worktrees/` — where a launch plants its worktrees — plus
a legacy `.session` entry for worktrees an old backend labeled with the retired per-worktree state file;
live session state is the global store's `session.json`) — ignored under EVERY policy; and the RENDERS —
the `contractFiles()` + skill/agent files — whose entries the vote governs: present under `ignored`
(default), dropped under `committed` (the renders become ordinary committed files, which is how the
contract reaches un-adopted teammates/CI through native discovery). The block's HOME follows the same vote:
the tracked `<repo>/.gitignore` for committed/ignored, the per-clone `.git/info/exclude` for `hidden` —
zero repo footprint, with a host-TRACKED contract file covered by the clean/smudge [[content-filter]]
(ignoring a tracked file is a no-op — the filter keeps the pristine prose in the index while the block
reaches the working tree). The user's existing `.gitignore` entries are always preserved. The block in the
tracked `.gitignore` is **checkout-invariant**: it is one tracked file shared by the main checkout and
every worktree, so if the entries differed by where materialize ran, whichever flavor got committed would
leave the OTHER checkout re-dirtying it forever. The only entry that varies is Codex's hooks shim, which an
adapter places at the [[harness-adapter|main checkout]] (a worktree's codex reads the root's hooks): from
main it is `.codex/hooks.json`, from a worktree it escapes `proj` (`../…`). So each entry is anchored to
the checkout it LIVES under — project-relative when inside `proj`, else main-checkout-relative — which
resolves that shim to `.codex/hooks.json` from ANY checkout (a pattern naming a main-only path is a
harmless no-op in a worktree). Every checkout emits the identical block, so the committed `.gitignore` is
stable and materialize never re-dirties a clean tree. The Codex trust hash is not in-tree at all — it
lives in the global `~/.codex/config.toml`.

The net ideal path: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`, zero
further operation, no global pollution beyond the scoped Codex trust. The contract files are SpexCode-owned
generated artifacts, so a clone never carries a stale committed copy under the default policy — any
hand-written contract prose lives in the tracked `docs/AGENT_GUIDE.md` source, which the render folds back in.
