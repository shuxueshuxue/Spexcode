---
title: init-preset
status: active
hue: 100
desc: The preset system — default preset = the live .config instance set; non-default presets (careful) are cumulative template packages selection stacks on at `spex init`; selection only matters at seed time.
code:
  - spec-cli/templates/presets
related:
  - spec-cli/templates/spec/project/.config
---
# init-preset

The init preset is the **policy** half of adoption — *which* plugins a project ends up with. The
*mechanism* (the CLI scaffold that copies template files into a target tree) belongs to [[spex-init]];
this node describes only the preset **system**.

**Default preset = the instance.** The lean default preset *is* the [[.config]] instance set — the
dev-flow plugins SpexCode actually runs (the contract, the commands, the scout). It is also the seed a
plain `spex init` plants, shipped as the `spec-cli/templates/spec/project/.config` mirror of that live
tree. The dotted [[.config]] (the instance) and the un-dotted [[config]] (this spec of the config
system) stay strictly distinct: a **non-default** preset NEVER lives in `.config`.

**Non-default presets are template packages.** A more cautious tier — `careful` — is a separate
**source package** under `spec-cli/templates/presets/<name>/`, mirroring the default template layout (a
`.config/<plugin>` subtree). It is shippable CLI code, *not* a spec node in this repo and never part of
the live `.config` the launcher walks. Its first member is `clarify-before-code` — surface a misread as
a stated assumption in the proposal, blocking the human only on a load-bearing ambiguity.

**Cumulative.** The tiers form a chain, lean → cautious: `careful` is a strict superset of `default`.
Selecting `careful` seeds the default `.config` set AND stacks the careful package on top of it.

**The measurement contract ships in DEFAULT, not `careful`.** A loss signal that is blind from day one is
not a "careful-only" concern — it is the premise the whole optimizer rests on, and adoption coverage is
weakest exactly when the project is fresh, so a plain `spex init` must already push its workers to measure.
So the default `.config` seed carries the measurement discipline directly: the [[core]] contract body folds
in the "keep the loss signal honest — re-measure what you changed, give an obvious frontend change a
scenario, and measure a frontend scenario through the actual running product (a real browser), then FILE
that observation as the reading" rule, and a `reproduce-before-fix` plugin (`surface: system`) seeds the
fail→pass A/B repair discipline. Both are generic — no repo-specific paths or tool locations — so they
materialize into every adopter's `CLAUDE.md`/`AGENTS.md` contract block the same way they do here, and the
seeded `core/stop-gate` hook's yatsu advisory nudges an uncovered/stale node at a clean-done stop. That is
the fix for the adoption gap where a fresh project's contract carried zero measurement prose and its
workers browser-verified by instinct but never filed a yatsu reading.

**Templates are the canonical shipped seed; they must not fork from our own `.config`.** A published
`spec-cli` cannot read this dev repo's live `.spec`, so `spex init` seeds strictly from
`spec-cli/templates/spec/project/.config` — that template tree IS the canonical copy every adopter gets.
Our own `.spec/spexcode/.config` is this repo's live instance and is a **superset** (it carries extra
discipline like spec-first reading), but for the SHARED contract members — the [[core]] measurement prose,
`reproduce-before-fix`, and the `core/stop-gate` hook (whose yatsu advisory is specified by
[[yatsu-proactive]]) — the template must stay a faithful mirror of the live node. When the measurement
contract changes, update BOTH in the same node so an adopter's agents inherit exactly what ours do (the
self-launch/fresh-adoption path is the main body, not a privileged second class). A drift between the two
is the smell.

**Selection matters only at seed time.** A project picks its tier with `spex init --preset <name>`
(or an existing `spexcode.json` `preset` field); the named package is copied in on top of the default.
There is **no** per-plugin `preset:` field — membership is *which package directory a plugin lives in*,
not a frontmatter flag — and **no** launcher-side preset gate: once seeded, the running repo simply
gathers whatever ended up in its `.config`, so the whole notion of a preset is spent at `spex init` and
invisible thereafter.
