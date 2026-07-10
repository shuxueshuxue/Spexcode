---
title: spex-uninstall
status: active
hue: 20
desc: `spex uninstall [dir]` = materialize(∅) plus the store — the forgetting law's empty policy removes every generated artifact by its identity stamp, then the global per-project store and any plugin bundle go too; the user's `.spec`/`.config` data and prose are NEVER touched.
code:
  - spec-cli/src/uninstall.ts
related:
  - spec-cli/src/uninstall.test.ts
---

# spex-uninstall

`spex uninstall [dir]` (default: cwd) is the clean inverse of [[spex-init]] — and it is not a parallel
implementation of one: the in-tree/global-config backout **is dematerialize, the render's own erase phase
asserted against the empty policy** (the forgetting law's materialize(∅), [[harness-delivery]]). Whatever
any policy — harness set, [[render-policy]] vote, or a retired legacy mode — ever wrote, the same
identity-stamped erase forgets it; uninstall adds only what a per-run render never owns. It is **surgical,
never destructive**: every removal is gated on a SpexCode **identity stamp** (the managed-block sentinels,
the shim's own `dispatch.sh` command line, the trust sentinels, the generated mark / name-scoped on-demand
paths, the plugin name stamp), so it can only ever delete what SpexCode itself generated.

**The one inviolable rule — the user's spec ASSET is never touched.** `.spec` and `.config` are the user's own
spec data (the whole point of adopting the tool); uninstall **never** deletes or edits them. Nor does it touch
the user's own `CLAUDE.md`/`AGENTS.md` prose, a hand-made `settings.json`, a sibling skill the user added, or any
other user file. Uninstall removes only SpexCode's **generated wiring**, not the spec graph that wiring served.

It removes, for the resolved project:

- **everything dematerialize erases** — for EVERY adapter in `HARNESSES` (a total backout, where a render
  erases-then-asserts only the selected set): the managed contract block in `CLAUDE.md`/`AGENTS.md`
  (stripped via the sentinels; **`deleteIfEmpty`** removes a contract file that was WHOLLY ours, else the
  user's surrounding prose is preserved), the generated shim + worktree anchor (deleted only when they
  carry our `dispatch.sh` command line), the Codex **trust** block in the global `~/.codex/config.toml`,
  the skill/agent files (by the generated mark, plus the live `.config` names for pre-stamp legacy files),
  the managed ignore blocks in BOTH homes (the tracked `.gitignore`, `deleteIfEmpty`, and the per-clone
  `.git/info/exclude`), any legacy skip-worktree bit, and the [[content-filter]] — in the one order that
  matters: blocks leave the working files before the filter config goes, so no block residue surfaces as an
  uncommitted change.
- **the global per-project store** — `runtimeRoot(proj)` (`~/.spexcode/projects/<enc>/`): the hook manifest, the
  content-hash marker, the gate lock, and the project's session records. This is SpexCode's per-project runtime
  tier ([[runtime]]), not the user's spec asset, so the whole dir is ours to delete.
- **any spexcode plugin bundle** — a `plugins/spexcode` directory or a `.claude-plugin/plugin.json` whose
  `name == spexcode`, under the project's plugin-host folders. Identity-gated, so a user's other plugins are
  never touched; the sweep also cleans a hand-dropped bundle the emit ledger never knew.

**Git hooks are preserved by default.** The pre-commit / prepare-commit-msg hooks are per-clone (never committed),
and a user may have layered their own logic; silently deleting them on uninstall would be the opposite of surgical.
So uninstall leaves them in place unless `--hooks` is passed, and even then removes a hook **only** when its
content carries a SpexCode identity marker (so a user's own pre-commit is never deleted).

Like `init`, it resolves the target with cwd set to the project so the `.config` loaders read the right tree, and
reports exactly what it removed. It is idempotent: a second run finds nothing left and is a clean no-op.
