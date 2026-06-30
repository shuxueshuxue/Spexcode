---
title: spex-uninstall
status: active
hue: 20
desc: `spex uninstall [dir]` — the surgical inverse of `spex init`/`materialize`: remove every SpexCode-generated artifact (harness shims/contract/trust, the .gitignore block, the global store, any plugin bundle) while NEVER touching the user's `.spec`/`.config` data or their own prose.
code:
  - spec-cli/src/uninstall.ts
  - spec-cli/src/uninstall.test.ts
---

# spex-uninstall

`spex uninstall [dir]` (default: cwd) is the clean inverse of [[spex-init]]: where init/[[harness-delivery]]
WRITE the SpexCode footprint into a repo, uninstall REMOVES it — so a project can fully back out, leaving only
its own files behind. It is **surgical, never destructive**: every removal is gated on a SpexCode **identity
stamp** (the managed-block sentinels, the shim's own `dispatch.sh` command line, the trust sentinels, the
name-scoped on-demand paths, the plugin name stamp), so it can only ever delete what SpexCode itself generated.

**The one inviolable rule — the user's spec ASSET is never touched.** `.spec` and `.config` are the user's own
spec data (the whole point of adopting the tool); uninstall **never** deletes or edits them. Nor does it touch
the user's own `CLAUDE.md`/`AGENTS.md` prose, a hand-made `settings.json`, a sibling skill the user added, or any
other user file. Uninstall removes only SpexCode's **generated wiring**, not the spec graph that wiring served.

It removes, for the resolved project:

- **every harness's own artifacts** — for each adapter in `HARNESSES`, `h.clean(proj, arts)` ([[harness-adapter]]'s
  surgical inverse of the per-harness materialize write): the managed contract block in `CLAUDE.md`/`AGENTS.md`
  (stripped via the sentinels; **`deleteIfEmpty`** removes a contract file that was WHOLLY ours, else the user's
  surrounding prose is preserved), the generated shim (deleted only when it carries our `dispatch.sh` command
  line), the Codex **trust** block in the global `~/.codex/config.toml` (`clean` already calls `removeTrust`, so
  it is the FULL inverse including trust — uninstall does not re-strip it), and the `arts`-named skill/agent
  files. `arts` is the live `surface: skill`/`surface: agent` node names, read from the project's own `.config`.
  Where [[harness-delivery]]'s materialize `clean()`s only the **unselected** harnesses ([[harness-select]]),
  uninstall `clean()`s **every** harness — a total backout, not a per-config prune.
- **the shared `.gitignore` block** — the one in-tree artifact no adapter owns (materialize writes it directly, a
  managed `#` block), so uninstall strips it directly too: `removeManagedBlock` with the `#` comment style and
  `deleteIfEmpty` (a `.gitignore` that was nothing but our block is removed; otherwise the user's own entries
  stay). This mirrors exactly the write side in [[harness-delivery]].
- **the global per-project store** — `runtimeRoot(proj)` (`~/.spexcode/projects/<enc>/`): the hook manifest, the
  content-hash marker, the gate lock, and the project's session records. This is SpexCode's per-project runtime
  tier ([[runtime]]), not the user's spec asset, so the whole dir is ours to delete.
- **any spexcode plugin bundle** — a `plugins/spexcode` directory or a `.claude-plugin/plugin.json` whose
  `name == spexcode`, under the project's plugin-host folders. The removal is gated on that identity stamp, so a
  user's other plugins are never touched. The plugin bundle EMITTER is a later node ([[harness-select]] validates
  a plugin target but writes no bundle yet), so a native-only install has nothing here today; the sweep exists so
  uninstall stays a true inverse once the emitter lands, and so a hand-dropped bundle is cleaned too.

**Git hooks are preserved by default.** The pre-commit / prepare-commit-msg hooks are per-clone (never committed),
and a user may have layered their own logic; silently deleting them on uninstall would be the opposite of surgical.
So uninstall leaves them in place unless `--hooks` is passed, and even then removes a hook **only** when its
content carries a SpexCode identity marker (so a user's own pre-commit is never deleted).

Like `init`, it resolves the target with cwd set to the project so the `.config` loaders read the right tree, and
reports exactly what it removed. It is idempotent: a second run finds nothing left and is a clean no-op.
