---
title: .config
status: active
hue: 110
desc: The instance home — this repo's DIY dev-flow plugins live here as skill-shaped config nodes.
---
`.config/` is the **instance** of the config system: the concrete dev-flow plugins this repo ships for
working in it. Each plugin is a skill-shaped node — its folder *is* the unit (a `spec.md` plus any
co-located scripts) — sorted into a `slash/` or `system/` dir whose name IS its surface.

The launcher's system gather and the new-session dropdown read from here. Only **active** plugins
gather: a `pending` node is declared intent, not yet an active plugin. The seed ships `system/core`
(the spec-discipline contract folded into every agent) plus `slash/tidy` and `slash/health`; add your
own by creating sibling nodes under `system/` or `slash/`.
