---
title: spex-uninstall
status: active
hue: 20
desc: `spex uninstall [dir]` = materialize(∅) plus the store — remove all SpexCode-derived wiring and project-local state by ownership identity while preserving the user's tracked `.spec`/`.plugins`/`spexcode.json` intent and prose.
code:
  - spec-cli/src/uninstall.ts#uninstall
  - spec-cli/src/uninstall.ts#sweepPluginBundles
  - spec-cli/src/uninstall.ts#removeHooks
related:
  - spec-cli/src/uninstall.test.ts
  - spec-cli/src/help.ts
---

# spex-uninstall

`spex uninstall [dir]` (default: cwd) is the clean inverse of [[spex-init]] — and it is not a parallel
implementation of one: the in-tree/global-config backout **is dematerialize, the materialize's own erase phase
asserted against the empty policy** (the forgetting law's materialize(∅), [[harness-delivery]]). Whatever
any policy — harness set, the retired render vote, or an older legacy mode — ever wrote, the same
identity-stamped erase forgets it; uninstall adds only what a per-run materialize never owns. It is **surgical,
never destructive**: every removal is gated on SpexCode **ownership identity** (the managed-block sentinels,
the shim's own `dispatch.sh` command line, the trust sentinels, the generated mark / name-scoped on-demand
paths, the plugin name stamp, or byte-identity with a canonical hook template), so it can only ever delete what
SpexCode itself generated and the user has not modified.

**The inviolable rule — tracked intent is never touched.** `.spec` (including `.plugins`) and `spexcode.json`
are the user's adoption data. Their `CLAUDE.md`/`AGENTS.md` prose, hand-made settings, sibling skills, and other
user files also survive. Uninstall removes only derived wiring and local state, not the intent they served.

It removes, for the resolved project:

- **everything dematerialize erases** — for EVERY adapter in `HARNESSES` (a total backout, where a
  materialize erases-then-asserts only the selected set): the managed contract block in `CLAUDE.md`/`AGENTS.md`
  (stripped via the sentinels; **`deleteIfEmpty`** removes a contract file that was WHOLLY ours, else the
  user's surrounding prose is preserved), the generated shim + worktree anchor (deleted only when they
  carry our `dispatch.sh` command line), the Codex **trust** block in the global `~/.codex/config.toml`,
  the skill/agent files (by the generated mark, plus the live `.plugins` names for pre-stamp legacy files),
  the managed ignore blocks in BOTH homes (the tracked `.gitignore`, `deleteIfEmpty`, and the per-clone
  `.git/info/exclude`), any legacy skip-worktree bit, and the [[content-filter]] — in the one order that
  matters: blocks leave the working files before the filter config goes, so no block residue surfaces as an
  uncommitted change.
- **the global per-project store** — `runtimeRoot(proj)` (`~/.spexcode/projects/<enc>/`): the per-tree
  materialize slots (`trees/<enc-worktree>/` — hook manifest, content-hash stamp, plugin-folder ledger), any legacy
  pre-slot manifest, and the project's session records. This is SpexCode's per-project runtime
  tier ([[runtime]]), not the user's spec asset, so the whole dir is ours to delete.
- **any spexcode plugin bundle** — a `plugins/spexcode` directory or a `.claude-plugin/plugin.json` whose
  `name == spexcode`, under configured/standard hosts and hosts recovered from current or legacy ledgers **before
  store deletion**. Other plugins survive; standard-host scanning also catches hand-dropped bundles.

**Git hooks are preserved by default.** The pre-commit / prepare-commit-msg hooks are per-clone (never committed),
and a user may have layered their own logic; silently deleting them on uninstall would be the opposite of surgical.
So uninstall leaves them in place unless `--hooks` is passed, and even then removes a hook **only** when it is
byte-identical to one of the canonical generated hook templates. This covers every hook init can plant without a
name list drifting out of sync; a modified generated hook and every unrelated user hook survive.

Like `init`, it resolves the target with cwd set to the project so the `.plugins` loaders read the right tree, and
reports exactly what it removed. It is idempotent: a second run finds nothing left and is a clean no-op. One
public lifecycle smoke drives dirty Claude-only and Codex-only repos from a data table with user-owned controls.
