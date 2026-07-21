---
title: plugin-system
status: active
hue: 90
desc: The spec of SpexCode's plugin SYSTEM — how reflexive, skill-shaped plugin nodes are defined and how they plug in.
code:
  - spec-cli/src/specs.ts#configRoots
---
`plugin-system/` holds the **spec of the plugin system** — how SpexCode's reflexive, skill-shaped plugin
nodes work, *not* the plugins themselves. A plugin node is a folder where the folder *is* the unit (a
`spec.md` plus optional helper scripts/assets); it defines a tool behavior, and **where it plugs in is a
`surface` frontmatter field**:

- `surface: command` — exposed as an agent prompt preset on new and running sessions.
- `surface: system` — appended to agent system prompts.

The field-driven routing rule is specified by the [[surface]] child. The **instances** — the DIY dev-flow
plugins this product ships — live in the sibling [[.plugins]] tree, and that is what `/api/plugins` and the
launcher's system gather read. So: **plugin-system = the spec of the plugin system; .plugins = the instance
where the dev-flow plugins live.**

These nodes are reflexive: SpexCode's own behavior is configured by spec nodes, managed through the same
dogfood ritual as any other node. Frontmatter: `title`, `status`, `desc`, and `surface` (the routing field).
A plugin may also carry `kind` — `mutating` (the default) if it edits the spec graph, `report` if it only
reports on it — which the new-session `/` palette tags it by.

The instance root is `.plugins`. A pre-0.3.0 `.config`-only tree is refused loudly rather than gathered as
an empty surface that launches ungoverned agents. Its repair points to `spex doctor --migrate`; in the current
release that spelling is only a non-mutating tombstone directing the user through a 0.3.x bridge release.

**The init preset.** *Which* [[.plugins]] plugins `spex init` seeds into a new project — the shipped dev-flow
set vs. the spexcode-only holdbacks, and how the materialized template tree carries it — is its own scoped
policy, specified by the [[init-preset]] child.
