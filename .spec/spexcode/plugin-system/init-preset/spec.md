---
title: init-preset
status: active
hue: 100
desc: The preset system — the default seed is projected from the live .plugins authoring tree by explicit membership; non-default packages stack on at `spex init` (none ships today); selection only matters at seed time.
code:
  - scripts/sync-init-plugins.mjs
related:
  - spec-cli/templates/spec/project/.plugins
  - spec-cli/src/init.ts
  - scripts/sync-init-plugins.test.mjs
  - package.json
  - .github/workflows/ci.yml
---
# init-preset

The init preset owns adoption **policy** — which plugins a project receives. The scaffold and overlay copy
mechanism belongs to [[spex-init]].

**One authoring source.** The lean default is projected from the live [[.plugins]] instance SpexCode runs.
A plugin is seedable unless its `spec.md` says `seed: false`; that membership excludes its entire
SpexCode-only subtree and never permits a different version of shared content. The dotted instance and
un-dotted [[plugin-system]] remain distinct, and non-default presets never live in `.plugins`.

**No non-default preset ships today.** A future tier is a source package under
`spec-cli/templates/presets/<name>/` that mirrors a `.plugins/<plugin>` subtree. Tiers are cumulative from
lean to cautious: selection seeds the default and overlays each package through the chosen tier. Such a
package is shippable CLI data, not a live plugin node; it joins the chain through `PRESET_TIERS` only after
its behavior earns the added surface.

**Measurement ships in the default.** Fresh adoption is where coverage is weakest, so measurement cannot be
optional discipline. [[core]] requires re-measuring changed scenarios, matching evidence type to behavior,
filing only after the measured change is committed, and giving obvious frontend changes a real-browser
scenario. `reproduce-before-fix` supplies the fail→pass repair pair, while `core/stop-gate` gives cleanly
finished work the [[eval-proactive]] advisory. These shared contracts reach adopter and dogfood agents alike.

**The checked-in template is generated output.** Published code cannot read this repo's live `.spec`, so
`spex init` copies `spec-cli/templates/spec/project/.plugins`; the projection command derives that tree from
the live source. It includes seedable plugin definitions, helpers, and executable modes; renames the spec
root to `project`; and unwraps links to known nodes absent from the seed. `eval.md` scenarios and
commit-anchored `evals.ndjson` readings measure the dogfood implementation, so both remain with its git
database. No prose normalizer, content exception, or separately maintained adopter variant is allowed.

The same command writes and checks the projection. Repository lint, CI, and packaging compare every expected
byte, path, and executable bit, failing on changed, missing, or extra output. Core measurement prose,
`reproduce-before-fix`, stop-gate, and multi-file hook handlers therefore ship from exactly what SpexCode runs.

**Selection is spent at seed time.** `spex init --preset <name>` (or config's `preset`) chooses the cumulative
package overlay. There is no per-plugin `preset:` field and no launcher-side gate: runtime simply gathers the
plugins that were planted.
