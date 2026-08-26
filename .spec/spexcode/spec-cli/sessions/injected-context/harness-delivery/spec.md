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
  - spec-cli/src/file-write.ts
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
other branches. Session creation is its own one-render transaction: it defers the checkout hook's best-effort
refresh, copies the local snapshot, then materializes once under the creation failure/recovery boundary. A
harness event is never a trigger — the old dispatcher content-hash gate is retired, and
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
- **the shims** — each adapter's shim landed at its `shimFile()`, whatever ARTIFACT that harness
  auto-discovers to wire events to the dispatcher: a hooks JSON for claude/codex/zcode (`.claude/settings.json`
  / `.codex/hooks.json` / `.zcode/settings.json`, one entry per event), a generated event-bus plugin for opencode
  (`.opencode/plugins/spexcode.ts` — [[opencode-harness]]), or a generated extension for pi
  (`.pi/extensions/spexcode.ts` — [[pi-harness]]). The shape is the adapter's fact, not this pipeline's, and so
  is WHO OWNS the file: a spexcode-named file of ours is written verbatim, while a config file the host agent
  SHARES with the user takes only our identity-stamped hook entries, merged in beside whatever they already
  had ([[harness-adapter]]'s `shimOwnership`). This pipeline never learns which harness that is — it reads the
  ownership off the adapter and picks the writer. The post-erase empty-dir sweep covers each artifact dir AND its parent
  (never a checkout root), since a harness may nest its shim a level below its home. For a linked Codex
  worktree, the root checkout owns the executable `.codex/hooks.json` dispatcher. The worktree's
  `.codex/hooks.json` is an empty `{ "hooks": {} }` anchor only: Codex needs the project layer anchor, but
  parsing a second dispatcher there would execute every PreToolUse handler twice. Claude is the opposite
  case: it loads project settings from the session's cwd only (measured on Claude Code 2.1.241 — a hook
  configured solely in the main checkout never fires inside a nested linked worktree, and a worktree's
  generated settings file is picked up by a running session without a restart), so every worktree carries
  its own generated `.claude/settings.json`, and a session launched at the root fires the root's, never both.
  Retiring the nested shim in favour of the root silently disabled every Claude lifecycle hook (mark-active,
  stop-gate, the SessionStart runtime binding) for nested sessions. A settings file with user keys or hooks
  is merged, never replaced. **WHERE a shim lives and WHICH toolchain it names are two questions, and only the
  first is per-tree.** Every shim — the shared Codex project one and every tree-scoped Claude one — points at
  the main checkout's `dispatch.sh` and `spex.mjs`, even when materialize is invoked from a linked worktree; a
  worktree's CLI may only write its empty anchor and tree-local artifacts, never replace the shared hook owner.
  The second question used to be answered per scope, and the consequence was invisible and constant: a session's
  worktree is materialized by the BACKEND's install, so its shim named the checkout, and then the first commit
  inside that worktree ran pre-commit → materialize with the WORKTREE's install and rewrote the same shim to
  name the branch. Every session ran its opening turns on one toolchain and silently switched to another
  mid-flight, with no receipt anywhere. Neither half was wrong alone; having two answers was. The checkout is
  the right answer for the reason the project shim already gave, generalised: a session worktree is a DESK, not
  a toolchain install — it carries no dependencies of its own, so a tree-pointing shim makes a fresh session's
  very first hook try to build its branch, and a branch mid-edit on the hook path would be enforcing its own
  governance. In a throwaway or package-installed project where the main checkout
  has no local `spec-cli` tree, the renderer falls back to the invoking package's executable rather than
  emitting a path that cannot run;
- **the skills** — each `surface: skill` body as `<skillDir>/<name>/SKILL.md` (claude `.claude/skills/`, codex
  `.codex/skills/` — both ship the same `SKILL.md` primitive), loaded **on demand** by the node's
  `description`, not always-on like the contract. The dir is the adapter's `skillDir(proj)`; a harness with no
  skill primitive gets none. Exclude-hidden like the shims (generated, no user prose). A skill dir is SHARED
  with whatever the user put there, and a node name is not a claim on a path: a target that already exists
  WITHOUT the `GENERATED_MARK` stamp is their file, so the write is skipped and the collision REPORTED rather
  than resolved silently in our favour. The stamp gates both halves of the pass — write and erase — so a
  same-named skill of theirs survives adoption, re-materialize, and uninstall alike;
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
- **the content-hash marker** (same per-tree slot as the manifest), a diagnostic freshness record written
  before the final authority; the unconditional pre-commit materialize heals a partial pass.
- **the dispatch-family allowlist** (same slot), atomically renamed into place LAST. It is the sole success
  receipt consumed by dispatch, so a killed writer leaves the preceding successful selection intact.

The pass obeys a scoped **forgetting law**. One tree's semantic output is exactly its current policy. The
current target map reconciles by identity stamp: it removes landing points absent from that map and writes only
bytes that differ, so narrowing one tree removes its contract/shim/skills without touching a sibling while an
identical second pass is an operational no-op (no delete/recreate churn or watcher event). Project-scoped hook/trust wiring is installation transport,
not selection state: once a tree needs it, it may remain dormant until project-wide dematerialize/uninstall.
The dispatch-family allowlist in each existing tree runtime slot is the single final publication of a
successful pass, and gates that shared transport before admission or input handling; retaining the transport
therefore cannot activate a harness that this tree did not select. Idempotence is the same-policy case, and
project-wide dematerialize clears every accessible registered tree before shared substrate. A plugin target
stays exclusive ([[plugin-harness]]) and its arbitrary bundle folders remain in the same per-tree ledger.

The pass returns a **materialization receipt** alongside its content hash: the manifest and the exact contract,
shim, skill/agent, plugin-bundle, and trust paths asserted by this run. The receipt is populated at those writes,
with trust paths supplied by the adapter that performed the global write, so callers can report the selected
harness footprint without maintaining a second harness-artifact inventory.

Placement is harness-fact, not preference (verified): Codex auto-discovers ONLY the repo-root `./AGENTS.md`
(never `.codex/AGENTS.md`); Claude discovers `./CLAUDE.md` or `./.claude/CLAUDE.md`. Ignore is projected with
the same ownership split. Checkout-invariant machine residue (`spexcode.local.json`, `.worktrees/`, legacy
`.session`, and installed shared root transport) stays in the common `.git/info/exclude`. Selection-dependent local
shims, bundles, skills/agents, and wholly-ours contract files are one managed block in that tree's working
`.gitignore`. [[content-filter]] keeps a tracked host `.gitignore` pristine in the index, leaves an untracked
host file honestly visible, and lets a wholly generated one ignore itself. Contract and ignore payloads live
under the current tree slot; one common filter driver derives that slot from the invoking Git toplevel plus `%f`, so linked
trees never overwrite one another's bytes and user global ignore configuration is untouched. The Codex trust
hash remains global and project-scoped, and is removed by project-wide dematerialize/uninstall rather than a
sibling's selection change.

Materialize reads and writes only the current tree slot and current per-tree filter payload. It does not import
pre-slot ledgers, common ignore projections, or other retired-format receipts, and a normal pass never enumerates
registered sibling worktrees. Shared filter transport is refreshed in place; project-wide teardown may still inspect
registered trees when it is explicitly removing that shared transport. Older runtime state is not a supported
materialize input and must be removed through an explicit reinstall/uninstall operation.

The net ideal path: `npm install spexcode` → `spex init` → the user launches their own `claude`/`codex`, zero
further operation, no global pollution beyond the scoped Codex trust. The contract files are SpexCode-owned
generated artifacts, so a clone never carries a stale committed copy — and the only tracked source they are
assembled from is the plugin tree, so what an agent carries is always exactly what the graph says.
