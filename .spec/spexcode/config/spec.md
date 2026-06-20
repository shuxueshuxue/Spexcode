---
title: config
status: active
hue: 90
desc: The spec of SpexCode's config SYSTEM — how reflexive, skill-shaped config nodes are defined and how they plug in.
---
`config/` holds the **spec of the config system** — how SpexCode's reflexive, skill-shaped config nodes
work, *not* the plugins themselves. A config node is a folder where the folder *is* the unit (a `spec.md`
plus optional helper scripts/assets); it defines a tool behavior and declares how it plugs in via a
`surface` field:

- **slash** — exposed as a new-session command.
- **system** — appended to agent system prompts.
- **skill** — exposed as a Claude Code skill.
- **setup** — run at init.

The `surface` routing axis is specified by the [[surface]] child. The **instances** — the DIY dev-flow
plugins this product ships — live in the sibling [[.config]] tree, and that is what `/api/config` and the
launcher's surface gather read. So: **config = the spec of the config system; .config = the instance where
the dev-flow plugins live.**

These nodes are reflexive: SpexCode's own behavior is configured by spec nodes, managed through the same
dogfood ritual as any other node. Frontmatter: `title`, `status`, `desc`.
