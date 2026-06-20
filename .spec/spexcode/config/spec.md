---
title: config
status: active
hue: 90
desc: Home for SpexCode's reflexive, skill-shaped config nodes — plugins that define tool behaviors and declare how they plug in.
---
`config/` holds SpexCode's **reflexive** config nodes: skill-shaped plugins where the folder *is* the
unit (a `spec.md` plus optional helper scripts/assets). Each defines a tool behavior and declares how it
plugs in via a `surface` field:

- **slash** — exposed as a new-session command.
- **system** — appended to agent system prompts.
- **skill** — exposed as a Claude Code skill.
- **setup** — run at init.

These nodes are reflexive: SpexCode's own behavior is configured by spec nodes, managed through the same
dogfood ritual as any other node. Frontmatter: `title`, `status`, `desc`.
