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
not a daemon. It renders into the harness targets [[harness-select]] resolves from `spexcode.json` (default:
every native harness), writing, idempotently and scoped per project, for each SELECTED harness:

- **the hook manifest** (persistent; the [[hook-dispatch]] dispatcher reads it) — in the GLOBAL per-project
  store ([[runtime]]'s `runtimeRoot`), NOT the worktree;
- **the contract** — the tracked **docs guide** (`docs/AGENT_GUIDE.md` — the project's hand-written agent/
  contributor notes, the ONE piece of in-tree contract prose) FOLLOWED BY the `surface: system` bodies (in name
  order), assembled and written as a `<!-- spexcode:start -->…<!-- spexcode:end -->` block into `<repo>/AGENTS.md`
  (Codex) + `<repo>/CLAUDE.md` (Claude). Those contract files are **generated, gitignored artifacts** — exactly
  like the shims + skills below: regenerated per clone/launch, never committed. The guide SOURCE is the only
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

After writing every selected harness, materialize **prunes every UNSELECTED one** — `h.clean()` (the
[[harness-adapter]]'s surgical inverse of the write above) strips that harness's managed contract block, deletes
its generated shim, removes its trust block, and removes its named skill/agent files. So dropping a harness from
[[harness-select]]'s `harnesses` set removes its products on the next re-materialize, the user's own prose and
`.spec` data untouched. A plugin target is exclusive, so selecting one prunes EVERY native harness, then
[[plugin-harness]] emits the whole system as one self-contained Claude-plugin bundle into the named folder
(materialize keeps a small ledger of the last-emitted plugin folders so a DESELECTED folder's bundle is pruned
on the next re-materialize, the same back-edge the natives have).

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. Every in-tree artifact this
render writes is generated, so materialize gitignores it — a managed `#` block in `<repo>/.gitignore` whose
entries are the adapters' own `contractFiles()` + `shimFile()`s + skill `SKILL.md`s, plus SpexCode's own
per-clone SESSION artifacts (`.worktrees/` — where a launch plants its worktrees — and the `.session` state
file), never the adopter's code (the user's existing .gitignore is preserved), all re-rendered per clone/
machine, never committed. The
**contract files** join that block precisely because their whole content is generated (the docs guide + the
system block) — they carry no committed prose of their own; only the guide SOURCE (`docs/AGENT_GUIDE.md`) is
tracked. The shim files additionally carry THIS machine's absolute install path, so they are also machine-local.
That managed block is **checkout-invariant**: `.gitignore` is one tracked file shared by the main checkout and
every worktree, so if the block's entries differed by where materialize ran, whichever flavor got committed
would leave the OTHER checkout re-dirtying it forever. The only entry that varies is Codex's hooks shim, which
an adapter places at the [[harness-adapter|main checkout]] (a worktree's codex reads the root's hooks): from
main it is `.codex/hooks.json`, from a worktree it escapes `proj` (`../…`). So each entry is anchored to the
checkout it LIVES under — project-relative when inside `proj`, else main-checkout-relative — which resolves that
shim to `.codex/hooks.json` from ANY checkout (a pattern naming a main-only path is a harmless no-op in a
worktree). Every checkout emits the identical block, so the committed `.gitignore` is stable and materialize
never re-dirties a clean tree. The Codex trust hash is not in-tree at all — it lives in
the global `~/.codex/config.toml`.

That "gitignored, never committed" promise holds cleanly only when a contract file is WHOLLY ours; on a host
that ALREADY tracks its own `CLAUDE.md`/`AGENTS.md`/`.gitignore`, ignoring a tracked file is a no-op and the
folded-in block leaks into shared history. [[private-overlay]] (the machine-local `private` toggle) closes that
gap: the identical render redirects its managed ignore block to the per-clone `.git/info/exclude` (widened to
hide `.spec` + `spexcode.json`) and marks any already-tracked contract file `skip-worktree`, so the whole
contract still reaches a self-launched agent while nothing enters the host's tracked files. It is reversible —
the default render re-asserts the inverse — so this stays one delivery mechanism with two modes, not a fork.

The net ideal path: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`, zero
further operation, no global pollution beyond the scoped Codex trust. The contract files are SpexCode-owned
generated artifacts (gitignored), so a clone never carries a stale committed copy — any hand-written contract
prose lives in the tracked `docs/AGENT_GUIDE.md` source, which the render folds back in.
