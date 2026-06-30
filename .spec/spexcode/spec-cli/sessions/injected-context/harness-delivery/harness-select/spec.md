---
title: harness-select
status: active
hue: 280
desc: Declarative choice of WHICH harness targets `spex materialize` delivers into — spexcode.json's `harnesses` set (native ids, or one plugin), validated fail-loud; deselecting a harness prunes its artifacts.
code:
  - spec-cli/src/harness-select.ts
  - spec-cli/src/harness-select.test.ts
---

# harness-select

A project does not always want SpexCode delivered into every harness. `harness-select` is the ONE declarative
knob for that choice: the `harnesses` field in `spexcode.json`. It is PERSISTENT config, never a one-shot flag,
because [[harness-delivery]]'s `materialize` is driven by a content-hash gate (re-run on every `.config` edit) —
the intent must live where every re-materialize re-reads it, not in a command a human has to remember.

The vocabulary is small. Each member is either a NATIVE harness id (`claude`, `codex` — the ids the
[[harness-adapter]] registers) or a PLUGIN bundle. Omitting the field defaults to every native harness (the
zero-config "deliver natively, everywhere"); it never silently collapses to "nothing".

Two invariants are enforced fail-loud — an illegal set aborts `materialize`/`spex init` with a stated reason,
never a silent or partial delivery:

- **plugin exclusivity** — a set containing a plugin may carry NO native harness. A plugin bundle is a SUPERSET
  delivery to its host agent, so pairing it with a native harness double-delivers. Choose EITHER native
  harnesses OR plugin(s).
- **explicit plugin folder** — a plugin target MUST name its landing folder (`.claude` / `.zcode` / `.codex` /
  custom), because every host agent scans a different plugins dir. A bare `"plugin"` with no folder is rejected.

This node owns ONLY the vocabulary + validation (`resolveHarnessTargets`) and the select-vs-prune split
(`partitionHarnesses`). It does NOT emit plugin bundles — that adapter is a later node, so a plugin target
validates but produces no artifact yet (and, being exclusive, leaves every native harness UNSELECTED → pruned).

Selection has a back-edge. `materialize` write()s the SELECTED harnesses and clean()s the UNSELECTED ones (the
[[harness-adapter]]'s clean primitive), so NARROWING `harnesses` prunes the dropped harness's products on the
next re-materialize — its managed contract block, generated shim, trust, and named skill/agent files — while
the user's own prose and `.spec` data are never touched.
