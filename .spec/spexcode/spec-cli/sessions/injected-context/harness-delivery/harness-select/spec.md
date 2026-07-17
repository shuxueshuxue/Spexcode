---
title: harness-select
status: active
hue: 280
desc: Declarative choice of WHICH harness targets `spex materialize` delivers into — spexcode.json's `harnesses` set (native ids, or one plugin), validated fail-loud, honored on every materialize leg, self-healing through the gate; deselecting a harness prunes its artifacts.
code:
  - spec-cli/src/harness-select.ts#resolveHarnessTargets
  - spec-cli/src/harness-select.ts#partitionHarnesses
related:
  - spec-cli/src/harness-select.test.ts
  - spec-cli/src/materialize.test.ts
---

# harness-select

A project does not always want SpexCode delivered into every harness. `harness-select` is the ONE declarative
knob for that choice: the `harnesses` field in `spexcode.json`. It is PERSISTENT config, never a one-shot flag,
because [[harness-delivery]]'s `materialize` re-runs at every git-native anchor ([[commit-surgery]]) —
the intent must live where every re-materialize re-reads it, not in a command a human has to remember.

The vocabulary is small. Each member is either a NATIVE harness id (`claude`, `codex` — the ids the
[[harness-adapter]] registers) or a PLUGIN bundle. **There is no default set**: the field is REQUIRED, an
explicit adopter choice that [[spex-init]] demands up front (`spex init --harness <ids>`, the CLI spelling
`parseHarnessFlag` translates — `plugin:<folder>` for a bundle) and stamps into `spexcode.json`. A missing
field fails loud with that stamp as the named repair. The old zero-config "deliver to every native harness"
was retired because it scales exactly wrong: every harness added to the registry would silently start
littering every adopter's tree — and global tool configs (`~/.codex`, …) — with artifacts for CLIs they
never installed.

Three invariants are enforced fail-loud — an illegal set aborts `materialize`/`spex init` with a stated reason,
never a silent or partial delivery. A missing field is the third: same loud abort, repair named above.

- **plugin exclusivity** — a set containing a plugin may carry NO native harness. A plugin bundle is a SUPERSET
  delivery to its host agent, so pairing it with a native harness double-delivers. Choose EITHER native
  harnesses OR plugin(s).
- **explicit plugin folder** — a plugin target MUST name its landing folder (`.claude` / `.zcode` / `.codex` /
  custom), because every host agent scans a different plugins dir. A bare `"plugin"` with no folder is rejected.

This node owns ONLY the vocabulary + validation (`resolveHarnessTargets`) and the select-vs-prune split
(`partitionHarnesses`, which hands the resolved plugin folders to its `plugins` result). It does NOT emit plugin
bundles — that is [[plugin-harness]], which materialize drives off `partitionHarnesses`'s `plugins`; here a
plugin target only validates (and, being exclusive, leaves every native harness UNSELECTED → pruned).

**The chain contract — every materialize leg honors the persisted selection.** materialize is reached by four
distinct legs, and ALL of them read the same `spexcode.json` set (via `readConfig(mainCheckout)`), never a
default full set: `spex init`'s adoption materialize, a manual `spex materialize`, the pre-commit anchor's
unconditional materialize ([[commit-surgery]]), and the worktree materialize at session creation
(`bootstrapMaterialize`). Concretely: a codex-only
repo (`"harnesses": ["codex"]`) never grows a `.claude/` or a CLAUDE.md block through ANY leg — and a
harness event through dispatch.sh materializes nothing at all. Proven
end-to-end (through the real CLI + dispatch.sh) in `materialize.test.ts`.

Selection has a back-edge, and it is part of policy P under the forgetting law ([[harness-delivery]]).
`materialize` write()s the SELECTED harnesses, and the erase phase (which sweeps ALL harnesses by identity
stamp) forgets the rest — so NARROWING `harnesses` prunes the dropped harness's products on the next
materialize:
its managed contract block, generated shim, trust, skill/agent files, and the emptied dirs themselves — while
the user's own prose and `.spec` data are never touched. And that next materialize needs no human: the
freshness key
(`hp_config_hash`, [[harness-delivery]]) covers the persisted policy files (the main checkout's
`spexcode.json` + `spexcode.local.json`), so a selection edit alone moves the key, and the very next
git-native anchor ([[commit-surgery]] — the commit/checkout/merge that carries the edit, or a manual
`spex materialize`) re-materializes under the new set — a selection change SELF-HEALS through the product
path, never via a harness event and never waiting for an unrelated `.plugins` edit.
