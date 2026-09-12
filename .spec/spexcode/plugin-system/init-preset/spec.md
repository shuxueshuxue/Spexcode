---
title: init-preset
status: active
hue: 100
desc: The preset system — the default seed is a second tracked copy of the live .plugins tree, held to it by a checker rather than generated; non-default packages stack on at `spex init` (none ships today); selection only matters at seed time.
code:
  - scripts/check-init-plugins.mjs
related:
  - spec-cli/templates/spec/project/.plugins
  - spec-cli/src/init.ts
  - scripts/check-init-plugins.test.mjs
  - package.json
  - .github/workflows/ci.yml
---
# init-preset

The init preset owns adoption **policy** — which plugins a project receives. The scaffold and overlay copy
mechanism belongs to [[spex-init]].

**One authoring source.** The lean default says exactly what the live [[.plugins]] instance SpexCode runs says.
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
finished work the the measurement nudge advisory. These shared contracts reach adopter and dogfood agents alike.

**The checked-in seed is a second tracked copy, and a checker holds it to the first.** Published code cannot
read this repo's live `.spec`, so `spex init` copies `spec-cli/templates/spec/project/.plugins`, and that tree
is edited by hand alongside the one it mirrors. It carries every seedable plugin definition, helper, and
executable mode, and differs in exactly two ways: it names its own spec root, and it drops the `seed:` line a
seeded tree has nothing left to decide about. `measurement contract` scenarios and commit-anchored
`measurement records` readings measure the dogfood implementation, so both remain with its git database. No
prose normalizer, content exception, or separately maintained adopter variant is allowed.

IT IS CHECKED, NOT GENERATED, and the difference is the whole point. A generator had a `--write`, and the
recorded failure is what a `--write` makes possible: nine files "written by an older projection and never
regenerated", red on the trunk itself. A check has no such state — either the two copies say the same thing or
the gate is red. It also refuses, rather than silently rewriting, a `[[link]]` to a node this repository has
and the seed does not ship: that link would reach an adopter as a dangling mention in a node they never wrote,
and a rule an author can follow beats a rewrite they never see. Repository lint, CI, and packaging compare
every byte, path, and executable bit, failing on changed, missing, or extra files. Core measurement prose,
`reproduce-before-fix`, stop-gate, and multi-file hook handlers therefore ship as exactly what SpexCode runs.

**Selection is spent at seed time.** `spex init --preset <name>` (or config's `preset`) chooses the cumulative
package overlay. There is no per-plugin `preset:` field and no launcher-side gate: runtime simply gathers the
plugins that were planted.
