---
title: .plugins
status: active
hue: 110
desc: The instance home — this repo's DIY dev-flow plugins live here as skill-shaped plugin nodes.
---
`.plugins/` is the **instance** of the plugin system: the concrete dev-flow plugins this repo ships for
working in it. Each plugin is a skill-shaped node — its folder *is* the unit (a `spec.md` plus any
co-located scripts) — carrying a `surface: command|system|…` field that names where it plugs in.
Discovery is recursive and field-driven, so plugins may sit under a grouping shelf: the auxiliary
`surface: system` prompt contracts live under `prompts/`, the `surface: command` presets under
`commands/`, the `surface: skill` plugins under `skills/`, while `core` — the contract subsystem whose
children are the `surface: hook` gates — sits as a flat child here.

The launcher's system gather and the new-session dropdown read from here. Only **active** plugins
gather: a `pending` node is declared intent, not yet an active plugin. The seed ships `core`
(`surface: system` — the spec-discipline contract folded into every agent) plus command presets like
`tidy`; add your own by creating a sibling node with a `surface` field.
