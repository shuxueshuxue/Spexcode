---
title: init-preset
status: active
hue: 100
desc: The preset system — default preset = the live .config instance set; non-default presets (careful) are cumulative template packages selection stacks on at `spex init`; selection only matters at seed time.
code:
  - spec-cli/templates/presets
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

**Selection matters only at seed time.** A project picks its tier with `spex init --preset <name>`
(or an existing `spexcode.json` `preset` field); the named package is copied in on top of the default.
There is **no** per-plugin `preset:` field — membership is *which package directory a plugin lives in*,
not a frontmatter flag — and **no** launcher-side preset gate: once seeded, the running repo simply
gathers whatever ended up in its `.config`, so the whole notion of a preset is spent at `spex init` and
invisible thereafter.
