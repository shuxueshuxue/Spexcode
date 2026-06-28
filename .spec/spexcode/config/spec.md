---
title: config
status: active
hue: 90
desc: The spec of SpexCode's config SYSTEM — how reflexive, skill-shaped config nodes are defined and how they plug in.
---
`config/` holds the **spec of the config system** — how SpexCode's reflexive, skill-shaped config nodes
work, *not* the plugins themselves. A config node is a folder where the folder *is* the unit (a `spec.md`
plus optional helper scripts/assets); it defines a tool behavior, and **where it plugs in is a `surface`
frontmatter field**:

- `surface: slash` — exposed as a new-session command.
- `surface: system` — appended to agent system prompts.

The field-driven routing rule is specified by the [[surface]] child. The **instances** — the DIY dev-flow
plugins this product ships — live in the sibling [[.config]] tree, and that is what `/api/config` and the
launcher's system gather read. So: **config = the spec of the config system; .config = the instance where
the dev-flow plugins live.**

These nodes are reflexive: SpexCode's own behavior is configured by spec nodes, managed through the same
dogfood ritual as any other node. Frontmatter: `title`, `status`, `desc`, and `surface` (the routing field).
A plugin may also carry `kind` — `mutating` (the default) if it edits the spec graph, `report` if it only
reports on it — which the new-session `/` palette tags it by.

**The init preset.** `spex init` seeds a new project with a **preset** of [[.config]] plugins — the universal
spec-discipline machinery every adopter gets — shipped as the CLI's `templates/spec/project/.config` tree. The
rule: **every active `.config` plugin ships EXCEPT the spexcode-only ones** — plugins bound to *this* repo's own
setup that must never reach an adopter. Today exactly two are spexcode-only: `taste` (SpexCode's own engineering
principles, which an adopter authors for themselves) and `voice-before-ask` (needs this repo's local voice MCP).
So the current preset is `core` (+ its hooks), `extract`, `forge-link`, `memory-hygiene`, `regroup`, `scenario`,
`supervisor`, `tidy`. The template *is* that preset, materialized — kept in sync by hand today (a new preset
plugin must be copied over), so regenerating it from this set minus the spexcode-only nodes is the durable fix.
