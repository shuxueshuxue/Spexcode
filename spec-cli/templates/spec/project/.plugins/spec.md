---
title: .plugins
status: active
hue: 110
desc: The instance home — this repo's DIY dev-flow plugins live here as skill-shaped plugin nodes.
---
`.plugins/` is the **instance** of the plugin system: the concrete dev-flow plugins this repo ships for
working in it. Each plugin is a skill-shaped node — its folder *is* the unit (a `spec.md` plus any
co-located scripts) — living as a flat child of `.plugins/` and carrying a `surface: command|system` field
that names where it plugs in.

The launcher's system gather and the new-session dropdown read from here. Only **active** plugins
gather: a `pending` node is declared intent, not yet an active plugin. The seed ships `core`
(`surface: system` — the spec-discipline contract folded into every agent) plus command presets like
`tidy`; add your own by creating a sibling node with a `surface` field.
