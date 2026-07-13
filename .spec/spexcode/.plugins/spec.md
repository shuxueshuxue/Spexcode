---
title: .plugins
status: active
hue: 110
desc: The instance home — SpexCode's DIY dev-flow plugins live here as skill-shaped plugin nodes.
---
`.plugins/` is the **instance** of the plugin system: the concrete dev-flow plugins SpexCode ships for
working in this repo. Each plugin is a skill-shaped node — its folder *is* the unit (a `spec.md` plus any
co-located scripts) — carrying a `surface: command|system|…` field that names where it plugs in, per
[[plugin-system]]'s [[surface]] field-driven routing. Discovery is recursive, so a plugin may sit under a
grouping shelf: the auxiliary `surface: system` prompt contracts live under [[prompts]], the `surface:
command` presets under [[commands]], the `surface: skill` plugins under [[skills]], the `surface: review`
remark presets under [[review]], while [[core]] — the dev-flow contract subsystem whose children are the
`surface: hook` gates — sits as a flat child beside them.

`/api/plugins` and the launcher's system gather read from here, not from [[plugin-system]] (which holds the
*spec of the plugin system* itself). Only **built/active** plugins gather — a `pending` node is declared
intent, not yet an active plugin, so it renders on the board but is neither offered as a command preset nor
materialized into the agent's contract.

Which of these plugins `spex init` ships to an adopter vs. keeps **spexcode-only** is the [[init-preset]]
rule. Only one is spexcode-only here — `taste` (this repo's *own* engineering principles)
(needs this repo's local voice MCP); every other active plugin ships.
