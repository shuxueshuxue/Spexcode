---
title: init-preset
status: active
hue: 100
desc: The preset system — default preset = the live .plugins instance set; a non-default preset would be a cumulative template package selection stacks on at `spex init` (none ships today); selection only matters at seed time.
related:
  - spec-cli/templates/spec/project/.plugins
  - spec-cli/src/init.ts
---
# init-preset

The init preset is the **policy** half of adoption — *which* plugins a project ends up with. The
*mechanism* (the CLI scaffold that copies template files into a target tree) belongs to [[spex-init]];
this node describes only the preset **system**.

**Default preset = the instance.** The lean default preset *is* the [[.plugins]] instance set — the
dev-flow plugins SpexCode actually runs (the contract, the commands, the scout). It is also the seed a
plain `spex init` plants, shipped as the `spec-cli/templates/spec/project/.plugins` mirror of that live
tree. The dotted [[.plugins]] (the instance) and the un-dotted [[plugin-system]] (this spec of the plugin
system) stay strictly distinct: a **non-default** preset NEVER lives in `.plugins`.

**Non-default presets are template packages — none ships today.** A non-default tier is a separate
**source package** under `spec-cli/templates/presets/<name>/`, mirroring the default template layout (a
`.plugins/<plugin>` subtree): shippable CLI code, *not* a spec node in this repo and never part of the
live `.plugins` the launcher walks. Tiers form a cumulative chain, lean → cautious — selecting a higher
tier seeds the default set AND stacks the named package on top. The mechanism (init.ts's tier chain +
overlay copy) stays live; the one shipped tier, `careful` (sole member `clarify-before-code`), was
retired as not worth its surface — a future tier re-enters by adding its package and its
`PRESET_TIERS` entry.

**The measurement contract ships in DEFAULT, not `careful`.** A loss signal that is blind from day one is
not a "careful-only" concern — it is the premise the whole optimizer rests on, and adoption coverage is
weakest exactly when the project is fresh, so a plain `spex init` must already push its workers to measure.
So the default `.plugins` seed carries the measurement discipline directly: the [[core]] contract body folds
in the "keep the loss signal honest — re-measure what you changed, give an obvious frontend change a
scenario, and measure a frontend scenario through the actual running product (a real browser), then FILE
that observation as the reading" rule, and a `reproduce-before-fix` plugin (`surface: system`) seeds the
fail→pass A/B repair discipline. Both are generic — no repo-specific paths or tool locations — so they
materialize into every adopter's `CLAUDE.md`/`AGENTS.md` contract block the same way they do here, and the
seeded `core/stop-gate` hook's eval advisory nudges an uncovered/stale node at a clean-done stop. That is
the fix for the adoption gap where a fresh project's contract carried zero measurement prose and its
workers browser-verified by instinct but never filed a eval reading.

**Templates are the canonical shipped seed; they must not fork from our own `.plugins`.** A published
`spec-cli` cannot read this dev repo's live `.spec`, so `spex init` seeds strictly from
`spec-cli/templates/spec/project/.plugins` — that template tree IS the canonical copy every adopter gets.
Our own `.spec/spexcode/.plugins` is this repo's live instance and is a **superset** (it carries extra
discipline like spec-first reading), but for the SHARED contract members — the [[core]] measurement prose,
`reproduce-before-fix`, and the `core/stop-gate` hook (whose eval advisory is specified by
[[eval-proactive]]) — the template must stay a faithful mirror of the live node. When the measurement
contract changes, update BOTH in the same node so an adopter's agents inherit exactly what ours do (the
self-launch/fresh-adoption path is the main body, not a privileged second class). A drift between the two
is the smell.

**Selection matters only at seed time.** A project picks its tier with `spex init --preset <name>`
(or an existing `spexcode.json` `preset` field); the named package is copied in on top of the default.
There is **no** per-plugin `preset:` field — membership is *which package directory a plugin lives in*,
not a frontmatter flag — and **no** launcher-side preset gate: once seeded, the running repo simply
gathers whatever ended up in its `.plugins`, so the whole notion of a preset is spent at `spex init` and
invisible thereafter.
